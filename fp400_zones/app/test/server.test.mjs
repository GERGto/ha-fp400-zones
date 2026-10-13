import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';

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
        if (match) return {child, port: Number(match[1]), output: () => output};
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
