/**
 * FP400 Zonen – Home Assistant app (add-on) backend.
 *
 * - gets MQTT credentials from the Supervisor (services: mqtt:need) or from options / environment
 * - sets Zigbee2MQTT up automatically: installs the FP400 converter via bridge/request/converter/save,
 *   configures the sensor, checks that positions arrive
 * - serves the zone editor through Home Assistant ingress and talks to it over a WebSocket
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import mqtt from 'mqtt';
import {WebSocketServer} from 'ws';
import {redact, rememberSecret, sameOrigin, validRequest} from './security.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);
const DATA_DIR = process.env.DATA_DIR || (ADDON ? '/data' : path.join(HERE, 'data'));
const OPTIONS = readJson(path.join(DATA_DIR, 'options.json')) ?? {};
const PORT = Number(process.env.PORT || 8099);
const BASE = String(OPTIONS.base_topic || process.env.BASE_TOPIC || 'zigbee2mqtt').replace(/\/+$/, '');
const AUTO_SETUP = (OPTIONS.auto_setup ?? (process.env.AUTO_SETUP !== 'false')) !== false;
const STATE_FILE = path.join(DATA_DIR, 'state.json');
for (const value of [process.env.SUPERVISOR_TOKEN, OPTIONS.mqtt_password, OPTIONS.mqtt_user,
    process.env.MQTT_PASSWORD, process.env.MQTT_USER]) rememberSecret(value);

const MODEL_ID = 'lumi.models.4447_8295';
const OUR_MODEL = 'PS-S05D';
const CONVERTER_NAME = 'aqara-fp400-zones.mjs';
const CONVERTER_CODE = fs.readFileSync(path.join(HERE, 'converter', CONVERTER_NAME), 'utf8');
const CONVERTER_VERSION = /CONVERTER_VERSION = '([^']+)'/.exec(CONVERTER_CODE)?.[1] ?? 'dev';
const STREAM_STALE_MS = 10 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------------------------------------------
// helpers

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

const persisted = readJson(STATE_FILE) ?? {};
persisted.configured ??= {};
persisted.layouts ??= {};
function persist() {
    try {
        fs.mkdirSync(DATA_DIR, {recursive: true});
        fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(persisted, null, 1));
        fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch (err) {
        log('warn', `Konnte ${STATE_FILE} nicht schreiben: ${err.message}`);
    }
}

const logLines = [];
function log(level, msg) {
    msg = redact(msg);
    const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
    console[level === 'error' ? 'error' : 'log'](`[${level}] ${msg}`);
    logLines.unshift(line);
    logLines.length = Math.min(logLines.length, 60);
    scheduleBroadcast();
}

function versionAtLeast(v, major) {
    const n = Number(String(v ?? '').split('.')[0]);
    return Number.isFinite(n) && n >= major;
}

// ---------------------------------------------------------------------------------------------------------------
// state

const S = {
    mqtt: {status: 'connecting', error: null, url: null},
    bridge: {state: null, info: null},
    converters: null, // [{name, code}] from bridge/converters
    devices: [], // FP400 entries from bridge/devices
    states: new Map(), // ieee -> last device state
    lastTargets: new Map(), // ieee -> timestamp
    busy: null,
    lastError: null,
    failures: new Map(), // action key -> timestamp of last failure
    permitJoinUntil: 0,
};

function externalJsEnabled() {
    const v = S.bridge.info?.config?.advanced?.enable_external_js;
    return v === undefined ? null : v === true;
}

function ourConverter() {
    if (!Array.isArray(S.converters)) return null;
    return S.converters.find((c) => c.name === CONVERTER_NAME) ?? null;
}

function foreignConverters() {
    if (!Array.isArray(S.converters)) return [];
    return S.converters.filter((c) => c.name !== CONVERTER_NAME && typeof c.code === 'string' && c.code.includes('4447_8295')).map((c) => c.name);
}

function deviceUsesOurDefinition(d) {
    return d.definition?.model === OUR_MODEL && /FP400-Zonen/.test(d.definition?.description ?? '');
}

function deviceConfigured(d) {
    return persisted.configured[d.ieee_address] === CONVERTER_VERSION;
}

function layoutFor(ieee) {
    const raw = S.bridge.info?.config?.devices?.[ieee]?.fp400_layout;
    if (raw) {
        try {
            return {layout: typeof raw === 'string' ? JSON.parse(raw) : raw, source: 'z2m'};
        } catch {
            // fall through to backup
        }
    }
    if (persisted.layouts[ieee]) return {layout: persisted.layouts[ieee], source: 'backup'};
    return {layout: null, source: null};
}

/** The setup checklist shown in the UI. status: ok | todo | busy | error | wait | off */
function setupSteps() {
    const steps = [];
    const z2mOnline = S.bridge.state === 'online';
    const info = S.bridge.info;
    steps.push({id: 'mqtt', label: 'MQTT-Broker', status: S.mqtt.status === 'connected' ? 'ok' : S.mqtt.status === 'error' ? 'error' : 'busy',
        detail: S.mqtt.status === 'connected' ? S.mqtt.url : S.mqtt.error ?? 'verbinde …'});
    if (S.mqtt.status !== 'connected') return steps;

    if (!info || !z2mOnline) {
        steps.push({id: 'z2m', label: 'Zigbee2MQTT', status: 'wait',
            detail: info ? 'Zigbee2MQTT ist offline' : `Keine Antwort auf ${BASE}/bridge/info – läuft Z2M und stimmt das Basis-Topic?`});
        return steps;
    }
    if (!versionAtLeast(info.version, 2)) {
        steps.push({id: 'z2m', label: 'Zigbee2MQTT', status: 'error', detail: `Version ${info.version} – bitte auf 2.x aktualisieren`});
        return steps;
    }
    steps.push({id: 'z2m', label: 'Zigbee2MQTT', status: 'ok', detail: `Version ${info.version}`});

    const ext = externalJsEnabled();
    if (ext !== true) {
        steps.push({id: 'external_js', label: 'Externe Converter erlauben', status: S.busy === 'external_js' ? 'busy' : info.restart_required ? 'todo' : 'todo',
            detail: info.restart_required ? 'Z2M muss neu gestartet werden' : 'In Z2M ist „enable_external_js“ aus. Ein Klick aktiviert es und startet Z2M neu.',
            action: info.restart_required ? {op: 'restartZ2m', label: 'Z2M neu starten'} : {op: 'enableExternalJs', label: 'Erlauben & neu starten',
                confirm: 'Zigbee2MQTT erlaubt danach externe Converter (eigener JavaScript-Code) und startet einmal neu (ca. 30 s). Fortfahren?'}});
        return steps;
    }

    const conv = ourConverter();
    const foreign = foreignConverters();
    let convStep;
    if (S.busy === 'install') convStep = {status: 'busy', detail: 'installiere …'};
    else if (!conv) convStep = {status: 'todo', detail: S.converters === null ? 'warte auf Converter-Liste …' : 'nicht installiert', action: {op: 'install', label: 'Installieren'}};
    else if (conv.code !== CONVERTER_CODE) convStep = {status: 'todo', detail: 'veraltete Version', action: {op: 'install', label: 'Aktualisieren'}};
    else convStep = {status: 'ok', detail: `v${CONVERTER_VERSION}`};
    if (S.lastError?.op === 'install' && convStep.status === 'todo') Object.assign(convStep, {status: 'error', detail: S.lastError.message});
    steps.push({id: 'converter', label: 'FP400-Converter', ...convStep});
    if (foreign.length) {
        steps.push({id: 'foreign', label: 'Andere FP400-Converter', status: 'error',
            detail: `${foreign.join(', ')} – sie stören die Zonen-Erkennung`,
            action: {op: 'removeForeign', label: 'Entfernen', confirm: `Diese Converter aus Zigbee2MQTT entfernen?\n${foreign.join('\n')}`}});
    }
    if (convStep.status !== 'ok') return steps;

    if (!S.devices.length) {
        const joining = S.permitJoinUntil > Date.now();
        steps.push({id: 'device', label: 'FP400-Sensor', status: joining ? 'busy' : 'todo',
            detail: joining ? 'Anlernen läuft – Knopf am Sensor 5 s drücken, bis die LED blinkt' : 'Kein FP400 in Zigbee2MQTT gefunden',
            action: joining ? null : {op: 'permitJoin', label: 'Anlernen starten'}});
        return steps;
    }
    for (const d of S.devices) {
        const name = d.friendly_name;
        if (!d.interview_completed && d.interview_state !== 'SUCCESSFUL') {
            steps.push({id: `dev:${d.ieee_address}`, label: name, status: 'busy', detail: 'Interview läuft …'});
            continue;
        }
        if (!deviceUsesOurDefinition(d)) {
            steps.push({id: `dev:${d.ieee_address}`, label: name, status: 'busy', detail: 'Z2M übernimmt den Converter …'});
            continue;
        }
        if (S.busy === `configure:${d.ieee_address}`) {
            steps.push({id: `dev:${d.ieee_address}`, label: name, status: 'busy', detail: 'konfiguriere Sensor …'});
            continue;
        }
        if (!deviceConfigured(d)) {
            const err = S.lastError?.op === `configure:${d.ieee_address}` ? S.lastError.message : null;
            steps.push({id: `dev:${d.ieee_address}`, label: name, status: err ? 'error' : 'todo', detail: err ?? 'muss konfiguriert werden',
                action: {op: 'configure', ieee: d.ieee_address, label: err ? 'Erneut versuchen' : 'Konfigurieren'}});
            continue;
        }
        const seen = S.lastTargets.get(d.ieee_address) ?? 0;
        const streaming = Date.now() - seen < STREAM_STALE_MS;
        steps.push({id: `dev:${d.ieee_address}`, label: name, status: streaming ? 'ok' : 'wait',
            detail: streaming ? 'Positionen kommen an' : 'Bereit – lauf einmal durch den Raum, um die Positionen zu prüfen',
            action: streaming ? null : {op: 'configure', ieee: d.ieee_address, label: 'Neu konfigurieren', quiet: true}});
    }
    return steps;
}

function snapshot() {
    return {
        type: 'snapshot',
        addon: ADDON,
        baseTopic: BASE,
        converterVersion: CONVERTER_VERSION,
        autoSetup: AUTO_SETUP,
        steps: setupSteps(),
        ready: setupSteps().every((s) => s.status === 'ok' || s.status === 'wait' && s.id.startsWith('dev:')),
        devices: S.devices.map((d) => ({
            ieee: d.ieee_address,
            name: d.friendly_name,
            ready: deviceUsesOurDefinition(d),
            ...layoutFor(d.ieee_address),
        })),
        log: logLines.slice(0, 20),
    };
}

// ---------------------------------------------------------------------------------------------------------------
// MQTT

let client = null;
const pending = new Map();

async function mqttSettings() {
    if (OPTIONS.mqtt_url) return {url: OPTIONS.mqtt_url, username: OPTIONS.mqtt_user || undefined, password: OPTIONS.mqtt_password || undefined};
    if (process.env.MQTT_URL) return {url: process.env.MQTT_URL, username: process.env.MQTT_USER || undefined, password: process.env.MQTT_PASSWORD || undefined};
    if (ADDON) {
        const res = await fetch('http://supervisor/services/mqtt', {headers: {Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`}, signal: AbortSignal.timeout(10000)});
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.result !== 'ok') {
            throw new Error(`Kein MQTT-Dienst gefunden (${body.message ?? res.status}). Ist das Mosquitto-Broker-Add-on installiert?`);
        }
        const d = body.data;
        return {url: `${d.ssl ? 'mqtts' : 'mqtt'}://${d.host}:${d.port}`, username: d.username, password: d.password};
    }
    return {url: 'mqtt://localhost:1883'};
}

async function connectMqtt() {
    let cfg;
    try {
        cfg = await mqttSettings();
    } catch (err) {
        S.mqtt = {status: 'error', error: redact(err.message), url: null};
        log('error', err.message);
        setTimeout(connectMqtt, 15000);
        return;
    }
    rememberSecret(cfg.username);
    rememberSecret(cfg.password);
    try {
        const endpoint = new URL(cfg.url);
        rememberSecret(decodeURIComponent(endpoint.username));
        rememberSecret(decodeURIComponent(endpoint.password));
        if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(endpoint.protocol)) throw new Error('Unsupported protocol');
    } catch {
        S.mqtt = {status: 'error', error: 'Ungültige MQTT-URL', url: null};
        log('error', S.mqtt.error);
        return;
    }
    S.mqtt.url = 'MQTT';
    client = mqtt.connect(cfg.url, {username: cfg.username, password: cfg.password, reconnectPeriod: 5000, connectTimeout: 10000,
        clientId: `fp400-zones-${crypto.randomBytes(3).toString('hex')}`});
    client.on('connect', () => {
        S.mqtt = {status: 'connected', error: null, url: 'MQTT'};
        log('info', 'MQTT verbunden');
        client.subscribe([`${BASE}/bridge/state`, `${BASE}/bridge/info`, `${BASE}/bridge/devices`, `${BASE}/bridge/converters`, `${BASE}/bridge/response/#`]);
        for (const d of S.devices) client.subscribe(`${BASE}/${d.friendly_name}`);
    });
    client.on('error', (err) => {
        S.mqtt.status = 'error';
        S.mqtt.error = redact(err.message);
        log('error', `MQTT: ${err.message}`);
    });
    client.on('close', () => {
        if (S.mqtt.status === 'connected') {
            S.mqtt.status = 'connecting';
            scheduleBroadcast();
        }
    });
    client.on('message', onMessage);
}

function publish(topic, payload, opts = {}) {
    if (!client?.connected) throw new Error('MQTT nicht verbunden');
    client.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), opts);
}

function z2mRequest(topic, payload, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const transaction = crypto.randomUUID();
        const timer = setTimeout(() => {
            pending.delete(transaction);
            reject(new Error(`Zigbee2MQTT antwortet nicht (${topic})`));
        }, timeoutMs);
        pending.set(transaction, {resolve, reject, timer, topic});
        try {
            publish(`${BASE}/bridge/request/${topic}`, {...payload, transaction});
        } catch (err) {
            clearTimeout(timer);
            pending.delete(transaction);
            reject(err);
        }
    });
}

let devicesSubscribed = new Set();

function onMessage(topic, buf) {
    const text = buf.toString();
    let msg;
    try {
        msg = text ? JSON.parse(text) : null;
    } catch {
        msg = text;
    }
    if (topic === `${BASE}/bridge/state`) {
        const prev = S.bridge.state;
        S.bridge.state = typeof msg === 'object' && msg ? msg.state : msg;
        if (prev && prev !== S.bridge.state) log('info', `Zigbee2MQTT ist ${S.bridge.state}`);
        if (S.bridge.state !== 'online') S.converters = null;
        return changed();
    }
    if (topic === `${BASE}/bridge/info`) {
        S.bridge.info = msg;
        return changed();
    }
    if (topic === `${BASE}/bridge/converters`) {
        S.converters = Array.isArray(msg) ? msg : [];
        return changed();
    }
    if (topic === `${BASE}/bridge/devices`) {
        const list = Array.isArray(msg) ? msg : [];
        S.devices = list.filter((d) => d.model_id === MODEL_ID || d.definition?.model === OUR_MODEL);
        const names = new Set(S.devices.map((d) => d.friendly_name));
        for (const name of devicesSubscribed) if (!names.has(name)) client.unsubscribe(`${BASE}/${name}`);
        for (const name of names) if (!devicesSubscribed.has(name)) client.subscribe(`${BASE}/${name}`);
        devicesSubscribed = names;
        if (S.devices.length) S.permitJoinUntil = 0;
        return changed();
    }
    if (topic.startsWith(`${BASE}/bridge/response/`)) {
        const p = msg && typeof msg === 'object' ? pending.get(msg.transaction) : null;
        if (p && topic === `${BASE}/bridge/response/${p.topic}`) {
            clearTimeout(p.timer);
            pending.delete(msg.transaction);
            if (msg.status === 'ok') p.resolve(msg.data);
            else p.reject(new Error(msg.error || 'Fehler'));
        }
        return;
    }
    const device = S.devices.find((d) => topic === `${BASE}/${d.friendly_name}`);
    if (device && msg && typeof msg === 'object') {
        S.states.set(device.ieee_address, msg);
        if (Array.isArray(msg.targets) && msg.targets.length) {
            const first = !S.lastTargets.has(device.ieee_address);
            S.lastTargets.set(device.ieee_address, Date.now());
            if (first) {
                log('info', 'FP400: Positionen kommen an');
                scheduleBroadcast();
            }
        }
        broadcast({type: 'state', ieee: device.ieee_address, state: msg});
    }
}

// ---------------------------------------------------------------------------------------------------------------
// actions

async function runAction(key, fn) {
    if (S.busy) throw new Error('Es läuft bereits eine Aktion');
    S.busy = key;
    S.lastError = null;
    scheduleBroadcast();
    try {
        const result = await fn();
        S.failures.delete(key);
        return result;
    } catch (err) {
        S.lastError = {op: key, message: redact(err.message)};
        S.failures.set(key, Date.now());
        log('error', err.message);
        throw err;
    } finally {
        S.busy = null;
        changed();
    }
}

const actions = {
    async enableExternalJs() {
        return runAction('external_js', async () => {
            log('info', 'Aktiviere externe Converter in Zigbee2MQTT');
            await z2mRequest('options', {options: {advanced: {enable_external_js: true}}});
            log('info', 'Starte Zigbee2MQTT neu …');
            await z2mRequest('restart', {}, 15000).catch(() => {});
        });
    },
    async restartZ2m() {
        return runAction('external_js', async () => {
            log('info', 'Starte Zigbee2MQTT neu …');
            await z2mRequest('restart', {}, 15000).catch(() => {});
        });
    },
    async install() {
        return runAction('install', async () => {
            log('info', `Installiere ${CONVERTER_NAME} v${CONVERTER_VERSION}`);
            await z2mRequest('converter/save', {name: CONVERTER_NAME, code: CONVERTER_CODE}, 60000);
            // Z2M confirmed the save; don't depend on the bridge/converters republish to arrive first.
            S.converters = [...(S.converters ?? []).filter((c) => c.name !== CONVERTER_NAME), {name: CONVERTER_NAME, code: CONVERTER_CODE}];
            log('info', 'Converter installiert');
        });
    },
    async removeForeign() {
        return runAction('remove', async () => {
            for (const name of foreignConverters()) {
                await z2mRequest('converter/remove', {name});
                log('info', `Converter ${name} entfernt`);
            }
        });
    },
    async permitJoin() {
        await z2mRequest('permit_join', {time: 254});
        S.permitJoinUntil = Date.now() + 254 * 1000;
        log('info', 'Anlernen für 4 Minuten erlaubt');
        changed();
    },
    async configure({ieee}) {
        const d = S.devices.find((x) => x.ieee_address === ieee);
        if (!d) throw new Error('Gerät nicht gefunden');
        return runAction(`configure:${ieee}`, async () => {
            log('info', 'Konfiguriere FP400 …');
            await z2mRequest('device/configure', {id: ieee}, 90000);
            persisted.configured[ieee] = CONVERTER_VERSION;
            persist();
            log('info', 'FP400 konfiguriert');
        });
    },
    async saveLayout({ieee, layout}) {
        if (!S.devices.some((d) => d.ieee_address === ieee)) throw new Error('Gerät nicht gefunden');
        if (!layout || typeof layout !== 'object' || !Array.isArray(layout.zones)) throw new Error('Ungültiges Layout');
        await z2mRequest('device/options', {id: ieee, options: {fp400_layout: JSON.stringify(layout)}});
        persisted.layouts[ieee] = layout;
        persist();
        log('info', 'Layout gespeichert');
    },
    async set({ieee, payload}) {
        const d = S.devices.find((x) => x.ieee_address === ieee);
        if (!d) throw new Error('Gerät nicht gefunden');
        publish(`${BASE}/${d.friendly_name}/set`, payload);
    },
    async get({ieee, payload}) {
        const d = S.devices.find((x) => x.ieee_address === ieee);
        if (!d) throw new Error('Gerät nicht gefunden');
        publish(`${BASE}/${d.friendly_name}/get`, payload);
    },
};

// Automatic setup: install / update the converter and configure the sensor without user interaction.
let autoTimer = null;
function changed() {
    scheduleBroadcast();
    if (!AUTO_SETUP) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(autoSetup, 800);
}

function recentlyFailed(key) {
    const t = S.failures.get(key);
    return t !== undefined && Date.now() - t < RETRY_MS;
}

async function autoSetup() {
    if (S.busy || S.mqtt.status !== 'connected' || S.bridge.state !== 'online' || !S.bridge.info) return;
    if (!versionAtLeast(S.bridge.info.version, 2) || externalJsEnabled() !== true || S.converters === null) return;
    const conv = ourConverter();
    if ((!conv || conv.code !== CONVERTER_CODE) && !recentlyFailed('install')) {
        await actions.install().catch(() => {});
        return;
    }
    for (const d of S.devices) {
        const key = `configure:${d.ieee_address}`;
        if (deviceUsesOurDefinition(d) && !deviceConfigured(d) && !recentlyFailed(key)) {
            await actions.configure({ieee: d.ieee_address}).catch(() => {});
            return;
        }
    }
}

// Periodically refresh the checklist (stream staleness, permit join countdown).
setInterval(scheduleBroadcast, 15000);

// ---------------------------------------------------------------------------------------------------------------
// HTTP + WebSocket

const sockets = new Set();
let broadcastTimer = null;

function scheduleBroadcast() {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
        broadcastTimer = null;
        broadcast(snapshot());
    }, 120);
}

function broadcast(obj) {
    const text = JSON.stringify(obj);
    for (const ws of sockets) if (ws.readyState === 1) ws.send(text);
}

function allowed(req) {
    if (!ADDON) return true;
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    return ip === '172.30.32.2';
}

const STATIC = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/icon.png': ['icon.png', 'image/png'],
};

const server = http.createServer((req, res) => {
    if (!allowed(req)) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
        res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({mqtt: S.mqtt.status, z2m: S.bridge.state}));
        return;
    }
    if (url.pathname === '/api/converter') {
        res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8', 'content-disposition': `attachment; filename="${CONVERTER_NAME}"`}).end(CONVERTER_CODE);
        return;
    }
    const entry = STATIC[url.pathname];
    if (!entry) {
        res.writeHead(404).end('Not found');
        return;
    }
    const file = path.join(HERE, 'public', entry[0]);
    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404).end('Not found');
            return;
        }
        res.writeHead(200, {'content-type': entry[1], 'cache-control': 'no-cache'}).end(data);
    });
});

const wss = new WebSocketServer({noServer: true, maxPayload: 64 * 1024});
server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (!allowed(req) || (!ADDON && !sameOrigin(req)) || url.pathname !== '/ws') {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.send(JSON.stringify(snapshot()));
    for (const [ieee, state] of S.states) ws.send(JSON.stringify({type: 'state', ieee, state}));
    ws.on('close', () => sockets.delete(ws));
    ws.on('error', () => { sockets.delete(ws); ws.terminate(); });
    ws.on('message', async (data) => {
        let req;
        try {
            req = JSON.parse(data.toString());
        } catch {
            return;
        }
        if (!validRequest(req, actions)) {
            ws.send(JSON.stringify({type: 'result', id: req?.id ?? null, ok: false, error: 'Ungültige Anfrage'}));
            return;
        }
        const fn = actions[req.op];
        const reply = (obj) => ws.readyState === 1 && ws.send(JSON.stringify({type: 'result', id: req.id, op: req.op, ...obj}));
        if (!fn) return reply({ok: false, error: `Unbekannte Aktion ${req.op}`});
        try {
            const data = await fn(req);
            reply({ok: true, data: data ?? null});
        } catch (err) {
            reply({ok: false, error: redact(err.message)});
        }
    });
});

server.listen(PORT, () => {
    log('info', `FP400 Zonen v${CONVERTER_VERSION} läuft auf Port ${server.address().port} (${ADDON ? 'Home-Assistant-App' : 'Standalone'})`);
    connectMqtt();
});

for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
        client?.end(true);
        server.close();
        process.exit(0);
    });
}
