import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import net from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import mqttPacket from 'mqtt-packet';

async function start(t, extra = {}) {
    const data = await mkdtemp(path.join(tmpdir(), 'fp400-test-'));
    const child = spawn(process.execPath, ['server.mjs'], {
        cwd: new URL('..', import.meta.url),
        env: {...process.env, PORT: '0', DATA_DIR: data, SUPERVISOR_TOKEN: '', MQTT_URL: 'mqtt://127.0.0.1:1', AUTO_SETUP: 'false', ...extra},
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        await rm(data, {recursive: true, force: true});
    });
    for (let i = 0; i < 100; i++) {
        const match = /läuft auf Port (\d+)/.exec(output);
        if (match) return {child, data, port: Number(match[1]), output: () => output};
        if (child.exitCode !== null) break;
        await delay(50);
    }
    throw new Error(`Server failed to start: ${output}`);
}

test('server serves UI, survives invalid requests, and exits on SIGTERM', {timeout: 15000}, async (t) => {
    const {child, port} = await start(t);
    const origin = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(origin)).status, 200);
    assert.equal((await fetch(`${origin}/missing`)).status, 404);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {origin});
    t.after(() => ws.terminate());
    await once(ws, 'open');
    for (const req of [null, [], {id: 1, op: 'constructor'}, {id: 2, op: 'saveLayout', ieee: '__proto__', layout: {zones: []}}]) {
        const reply = new Promise((resolve) => {
            const onMessage = (data) => {
                const result = JSON.parse(data);
                if (result.type !== 'result') return;
                ws.off('message', onMessage);
                resolve(result);
            };
            ws.on('message', onMessage);
        });
        ws.send(JSON.stringify(req));
        assert.equal((await reply).ok, false);
    }
    ws.send('{broken');
    assert.equal((await fetch(`${origin}/health`)).status, 200);
    ws.terminate();
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
});

test('cross-origin and oversized WebSockets are rejected without crashing', {timeout: 15000}, async (t) => {
    const {port} = await start(t);
    const foreign = new WebSocket(`ws://127.0.0.1:${port}/ws`, {origin: 'https://attacker.example'});
    await once(foreign, 'error');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {origin: `http://127.0.0.1:${port}`});
    t.after(() => ws.terminate());
    await once(ws, 'open');
    const closed = once(ws, 'close');
    ws.send('x'.repeat(65537));
    await closed;
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});

test('add-on rejects connections outside Supervisor ingress even with ALLOW_ALL', {timeout: 15000}, async (t) => {
    const {port} = await start(t, {SUPERVISOR_TOKEN: 'example-token', ALLOW_ALL: 'true'});
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 403);
});

test('automatic setup and layout saves wait for correlated Zigbee2MQTT replies', {timeout: 15000}, async (t) => {
    const requests = [];
    const clients = new Set();
    const ieee = '0x0000000000000001';
    let rejectLayout = false;
    const broker = net.createServer((socket) => {
        clients.add(socket);
        socket.on('close', () => clients.delete(socket));
        const parser = mqttPacket.parser();
        const send = (packet) => socket.write(mqttPacket.generate(packet));
        const publish = (topic, payload) => send({cmd: 'publish', topic: `zigbee2mqtt/${topic}`, payload: JSON.stringify(payload), qos: 0});
        socket.on('data', (data) => parser.parse(data));
        parser.on('packet', (packet) => {
            if (packet.cmd === 'connect') send({cmd: 'connack', returnCode: 0, sessionPresent: false});
            if (packet.cmd === 'pingreq') send({cmd: 'pingresp'});
            if (packet.cmd === 'subscribe') {
                send({cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map(() => 0)});
                if (packet.subscriptions.some((s) => s.topic === 'zigbee2mqtt/bridge/info')) {
                    publish('bridge/state', {state: 'online'});
                    publish('bridge/info', {version: '2.11.0', config: {advanced: {enable_external_js: true}}});
                    publish('bridge/converters', []);
                    publish('bridge/devices', [{ieee_address: ieee, friendly_name: 'Example sensor', model_id: 'lumi.models.4447_8295',
                        interview_completed: true, definition: {model: 'PS-S05D', description: 'FP400-Zonen'}}]);
                }
            }
            if (packet.cmd === 'publish' && packet.topic.includes('/bridge/request/')) {
                const topic = packet.topic.split('/bridge/request/')[1];
                const request = JSON.parse(packet.payload);
                requests.push({topic, request});
                publish(`bridge/response/${topic}`, {transaction: request.transaction,
                    status: topic === 'device/options' && rejectLayout ? 'error' : 'ok', error: 'Example failure', data: {}});
            }
        });
    });
    broker.listen(0, '127.0.0.1');
    await once(broker, 'listening');
    t.after(async () => {
        for (const client of clients) client.destroy();
        await new Promise((resolve) => broker.close(resolve));
    });
    const {port, data, output} = await start(t, {MQTT_URL: `mqtt://127.0.0.1:${broker.address().port}`, AUTO_SETUP: 'true'});
    for (let i = 0; i < 100 && !output().includes('FP400 konfiguriert'); i++) await delay(50);
    assert.deepEqual(requests.map((r) => r.topic), ['converter/save', 'device/configure']);
    assert.match(requests[0].request.code, /export default/);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {origin: `http://127.0.0.1:${port}`});
    t.after(() => ws.terminate());
    await once(ws, 'open');
    const save = async (id, layout) => {
        const reply = new Promise((resolve) => {
            const handler = (data) => {
                const result = JSON.parse(data);
                if (result.type !== 'result' || result.id !== id) return;
                ws.off('message', handler);
                resolve(result);
            };
            ws.on('message', handler);
        });
        ws.send(JSON.stringify({id, op: 'saveLayout', ieee, layout}));
        return reply;
    };
    const layout = {zones: []};
    assert.equal((await save(1, layout)).ok, true);
    const persisted = async () => JSON.parse(await readFile(path.join(data, 'state.json'), 'utf8'));
    assert.deepEqual((await persisted()).layouts[ieee], layout);
    rejectLayout = true;
    assert.equal((await save(2, {zones: [], targets_interval: 250})).ok, false);
    assert.deepEqual((await persisted()).layouts[ieee], layout);
});
