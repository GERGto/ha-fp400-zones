/**
 * FP400 Zones – Home Assistant app (add-on) backend.
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
import {Workflow, validateRoom} from './workflow.mjs';
import {normalize} from './public/model.js';

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
const APP_VERSION = readJson(path.join(HERE, 'package.json'))?.version ?? 'dev';
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
persisted.profiles ??= {};
persisted.settings ??= {theme: 'auto'};
function persist() {
    try {
        fs.mkdirSync(DATA_DIR, {recursive: true});
        fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(persisted, null, 1));
        fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch (err) {
        log('warn', `Could not write ${STATE_FILE}: ${err.message}`);
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
    return d.definition?.model === OUR_MODEL && /FP400[- ]Zone/.test(d.definition?.description ?? '');
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
    const steps = [{id: 'mqtt', label: 'MQTT broker', status: S.mqtt.status === 'connected' ? 'ok' : 'error', detail: S.mqtt.error || S.mqtt.status}];
    if (S.mqtt.status !== 'connected') return steps;
    steps.push({id: 'z2m', label: 'Zigbee2MQTT', status: S.bridge.state === 'online' ? 'ok' : 'wait', detail: S.bridge.info?.version || 'Waiting for Zigbee2MQTT'});
    if (S.bridge.state !== 'online' || !S.bridge.info) return steps;
    if (!versionAtLeast(S.bridge.info.version, 2)) { steps.push({id: 'version', label: 'Update Zigbee2MQTT', status: 'error', detail: 'Zigbee2MQTT 2.x is required'}); return steps; }
    if (externalJsEnabled() !== true) {
        steps.push({id: 'external_js', label: 'Allow external converters', status: 'todo', detail: 'Permission is required to install the FP400 converter.', action: {op: 'enableExternalJs', label: 'Allow and restart', confirm: 'Allow external JavaScript converters and restart Zigbee2MQTT?'}});
        return steps;
    }
    const conv = ourConverter();
    steps.push({id: 'converter', label: 'FP400 converter', status: conv?.code === CONVERTER_CODE ? 'ok' : 'todo', detail: S.lastError?.message || (conv?.code === CONVERTER_CODE ? CONVERTER_VERSION : 'Installation or update needed'), action: conv?.code === CONVERTER_CODE ? null : {op: 'install', label: 'Install converter'}});
    if (foreignConverters().length) steps.push({id: 'foreign', label: 'Conflicting converter', status: 'error', detail: 'Another FP400 converter is installed.', action: {op: 'removeForeign', label: 'Remove conflicting converters', confirm: 'Remove the other FP400 converters from Zigbee2MQTT?'}});
    return steps;
}

function snapshot() {
    const steps = setupSteps();
    return {
        type: 'snapshot',
        addon: ADDON,
        baseTopic: BASE,
        converterVersion: CONVERTER_VERSION,
        autoSetup: AUTO_SETUP,
        version: APP_VERSION,
        build: BUILD,
        settings: persisted.settings,
        connections: {mqtt: S.mqtt.status, z2m: S.bridge.state},
        permitJoinUntil: S.permitJoinUntil,
        steps,
        ready: steps.every((s) => s.status === 'ok' || s.status === 'wait' && s.id.startsWith('dev:')),
        devices: S.devices.map((d) => ({
            ieee: d.ieee_address,
            name: d.friendly_name,
            ready: deviceUsesOurDefinition(d),
            configured: deviceConfigured(d),
            profile: workflow.profile(d.ieee_address),
            learning: workflow.jobs.get(d.ieee_address) ?? null,
            state: S.states.get(d.ieee_address) ?? {},
            lastTargets: S.lastTargets.get(d.ieee_address) ?? null,
            stream: workflow.streams.get(d.ieee_address)?.reason ?? null,
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
            throw new Error(`MQTT service unavailable (${body.message ?? res.status}). Is the Mosquitto broker app installed?`);
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
        S.mqtt = {status: 'error', error: 'Invalid MQTT URL', url: null};
        log('error', S.mqtt.error);
        return;
    }
    S.mqtt.url = 'MQTT';
    client = mqtt.connect(cfg.url, {username: cfg.username, password: cfg.password, reconnectPeriod: 5000, connectTimeout: 10000,
        clientId: `fp400-zones-${crypto.randomBytes(3).toString('hex')}`});
    client.on('connect', () => {
        S.mqtt = {status: 'connected', error: null, url: 'MQTT'};
        log('info', 'MQTT connected');
        client.subscribe([`${BASE}/bridge/state`, `${BASE}/bridge/info`, `${BASE}/bridge/devices`, `${BASE}/bridge/converters`, `${BASE}/bridge/response/#`]);
        for (const d of S.devices) { client.subscribe(`${BASE}/${d.friendly_name}`); requestMounting(d); }
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
    if (!client?.connected) throw new Error('MQTT disconnected');
    client.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), opts);
}

function z2mRequest(topic, payload, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const transaction = crypto.randomUUID();
        const timer = setTimeout(() => {
            pending.delete(transaction);
            reject(new Error(`Zigbee2MQTT did not respond (${topic})`));
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
        if (prev && prev !== S.bridge.state) log('info', `Zigbee2MQTT is ${S.bridge.state}`);
        if (S.bridge.state !== 'online') S.converters = null;
        return changed();
    }
    if (topic === `${BASE}/bridge/info`) {
        S.bridge.info = msg;
        return changed();
    }
    if (topic === `${BASE}/bridge/converters`) {
        S.converters = Array.isArray(msg) ? msg.filter((c) => c && typeof c.name === 'string') : [];
        return changed();
    }
    if (topic === `${BASE}/bridge/devices`) {
        const list = Array.isArray(msg) ? msg : [];
        S.devices = list.filter((d) => d && typeof d.ieee_address === 'string' && typeof d.friendly_name === 'string'
            && (d.model_id === MODEL_ID || d.definition?.model === OUR_MODEL));
        const activeDevices = new Set(S.devices.map((d) => d.ieee_address));
        for (const cache of [S.states, S.lastTargets]) {
            for (const ieee of cache.keys()) if (!activeDevices.has(ieee)) cache.delete(ieee);
        }
        const names = new Set(S.devices.map((d) => d.friendly_name));
        for (const name of devicesSubscribed) if (!names.has(name)) client.unsubscribe(`${BASE}/${name}`);
        for (const d of S.devices) {
            if (devicesSubscribed.has(d.friendly_name)) continue;
            client.subscribe(`${BASE}/${d.friendly_name}`);
            requestMounting(d);
        }
        devicesSubscribed = names;
        closePairingIfComplete();
        return changed();
    }
    if (topic.startsWith(`${BASE}/bridge/response/`)) {
        const p = msg && typeof msg === 'object' ? pending.get(msg.transaction) : null;
        if (p && topic === `${BASE}/bridge/response/${p.topic}`) {
            clearTimeout(p.timer);
            pending.delete(msg.transaction);
            if (msg.status === 'ok') p.resolve(msg.data);
            else p.reject(new Error(msg.error || 'Error'));
        }
        return;
    }
    const device = S.devices.find((d) => topic === `${BASE}/${d.friendly_name}`);
    if (device && msg && typeof msg === 'object') {
        S.states.set(device.ieee_address, msg);
        // Device states are not retained on the broker; remember the mounting so the map is right after a restart.
        if (['wall', 'ceiling'].includes(msg.install_mode) && workflow.profile(device.ieee_address).installMode !== msg.install_mode) {
            workflow.update(device.ieee_address, {installMode: msg.install_mode});
        }
        workflow.observe(device.ieee_address, msg);
        scheduleBroadcast();
        if (Array.isArray(msg.targets) && msg.targets.length) {
            const first = !S.lastTargets.has(device.ieee_address);
            S.lastTargets.set(device.ieee_address, Date.now());
            if (first) {
                log('info', 'FP400: Position data received');
                scheduleBroadcast();
            }
        }
        broadcast({type: 'state', ieee: device.ieee_address, state: msg});
    }
}

/** Ask the sensor for its mounting so the room map uses the right grid without waiting for a report. */
function requestMounting(d) {
    if (!deviceUsesOurDefinition(d)) return;
    try {
        publish(`${BASE}/${d.friendly_name}/get`, {install_mode: '', side_install: '', install_height: ''});
    } catch { /* MQTT unavailable; the next connect retries. */ }
}

// ---------------------------------------------------------------------------------------------------------------
// actions

async function runAction(key, fn) {
    if (S.busy) throw new Error('Another action is already in progress');
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

let joinSession = null;
async function closePairingIfComplete() {
    const session = joinSession;
    if (!session || session.closing || S.permitJoinUntil <= Date.now()) return;
    const paired = S.devices.some((d) => !session.known.has(d.ieee_address) && (d.interview_completed === true || d.interview_state === 'SUCCESSFUL'));
    if (!paired) return;
    session.closing = true;
    try {
        await actions.closeJoin();
        log('info', 'New FP400 paired successfully; Zigbee2MQTT joining closed');
    } catch (err) {
        log('warn', 'Could not close joining after pairing: ' + err.message);
        session.closing = false;
    }
}
setInterval(closePairingIfComplete, 5000);

const actions = {
    async mounting({ieee, mode, side, height}) {
        const d = requireDevice(ieee);
        if (!['wall', 'ceiling'].includes(mode)) throw new Error('Invalid mounting type. Choose wall or ceiling.');
        if (mode === 'wall' && !['wall', 'left_corner', 'right_corner'].includes(side)) throw new Error('Invalid wall position. Choose flat wall, left corner or right corner.');
        if (!Number.isInteger(height) || height < 100 || height > 5000) throw new Error('Mounting height must be between 0.1 and 5 m.');
        if (!deviceUsesOurDefinition(d) || ourConverter()?.code !== CONVERTER_CODE) throw new Error('Wait for the current converter to finish installing before setting the mounting');
        const request = crypto.randomUUID();
        publish(`${BASE}/${d.friendly_name}/set`, {mounting: {request, mode, ...(mode === 'wall' ? {side} : {}), height}});
        const result = await sensorResult(ieee, 'mounting', request, 30000);
        if (result.status === 'timeout') throw new Error('The sensor did not confirm the mounting. Check Zigbee2MQTT logs and retry.');
        if (result.status !== 'verified') throw new Error(`The sensor did not accept the mounting: ${result.state.mounting_error || 'unknown error'}`);
    },
    async settings({theme}) {
        if (!['auto', 'light', 'dark'].includes(theme)) throw new Error('Invalid theme');
        persisted.settings.theme = theme;
        persist();
        scheduleBroadcast();
    },
    async watch({ieee}, owner) {
        if (ieee) requireDevice(ieee);
        workflow.watch(owner, ieee);
        tickWorkflow();
    },
    async profile({ieee, name, room, complete, mirror}) {
        const device = requireDevice(ieee);
        const patch = {};
        if (name !== undefined) {
            if (typeof name !== 'string' || name.length > 80) throw new Error('Use a name of up to 80 characters');
            patch.name = name.trim();
            if (!patch.name || (/[+#]/.test(patch.name) || [...patch.name].some((c) => c.charCodeAt(0) < 32))) throw new Error('Use a non-empty name without MQTT wildcards or control characters');
        }
        if (mirror !== undefined) patch.mirror = Boolean(mirror);
        if (room !== undefined) patch.room = validateRoom(room);
        if (complete) {
            if (!workflow.profile(ieee).learnedAt || !patch.room) throw new Error('Complete room learning and boundary tracing first');
            patch.completedAt = Date.now();
        }
        if (patch.name !== undefined && patch.name !== device.friendly_name) {
            return runAction('rename', async () => {
                const previous = device.friendly_name;
                await z2mRequest('device/rename', {from: ieee, to: patch.name, homeassistant_rename: false});
                const current = requireDevice(ieee);
                current.friendly_name = patch.name;
                if (!devicesSubscribed.has(patch.name)) client.subscribe(BASE + '/' + patch.name);
                devicesSubscribed.add(patch.name);
                if (previous !== patch.name && devicesSubscribed.has(previous)) {
                    client.unsubscribe(BASE + '/' + previous);
                    devicesSubscribed.delete(previous);
                }
                log('info', 'Sensor renamed in Zigbee2MQTT; MQTT subscription updated');
                return workflow.update(ieee, patch);
            });
        }
        return workflow.update(ieee, patch);
    },
    async learn({ieee}) { requireDevice(ieee); return workflow.startLearning(ieee); },
    async cancelLearn({ieee}) { requireDevice(ieee); workflow.cancelLearning(ieee); },
    async closeJoin() {
        await z2mRequest('permit_join', {time: 0});
        S.permitJoinUntil = 0;
        joinSession = null;
        changed();
    },
    async enableExternalJs() {
        return runAction('external_js', async () => {
            log('info', 'Enabling external converters in Zigbee2MQTT');
            await z2mRequest('options', {options: {advanced: {enable_external_js: true}}});
            log('info', 'Restarting Zigbee2MQTT …');
            await z2mRequest('restart', {}, 15000).catch(() => {});
        });
    },
    async restartZ2m() {
        return runAction('external_js', async () => {
            log('info', 'Restarting Zigbee2MQTT …');
            await z2mRequest('restart', {}, 15000).catch(() => {});
        });
    },
    async install() {
        return runAction('install', async () => {
            log('info', `Installing ${CONVERTER_NAME} v${CONVERTER_VERSION}`);
            await z2mRequest('converter/save', {name: CONVERTER_NAME, code: CONVERTER_CODE}, 60000);
            // Z2M confirmed the save; don't depend on the bridge/converters republish to arrive first.
            S.converters = [...(S.converters ?? []).filter((c) => c.name !== CONVERTER_NAME), {name: CONVERTER_NAME, code: CONVERTER_CODE}];
            log('info', 'Converter installed');
        });
    },
    async removeForeign() {
        return runAction('remove', async () => {
            for (const name of foreignConverters()) {
                await z2mRequest('converter/remove', {name});
                log('info', `Converter ${name} removed`);
            }
        });
    },
    async permitJoin() {
        const known = new Set(S.devices.map((d) => d.ieee_address));
        await z2mRequest('permit_join', {time: 254});
        S.permitJoinUntil = Date.now() + 254 * 1000;
        joinSession = {known, closing: false};
        closePairingIfComplete();
        log('info', 'Pairing enabled for 4 minutes');
        changed();
    },
    async configure({ieee}) {
        const d = S.devices.find((x) => x.ieee_address === ieee);
        if (!d) throw new Error('Device not found');
        return runAction(`configure:${ieee}`, async () => {
            log('info', 'Configuring FP400 …');
            await z2mRequest('device/configure', {id: ieee}, 90000);
            persisted.configured[ieee] = CONVERTER_VERSION;
            persist();
            log('info', 'FP400 configured');
        });
    },
    async saveLayout({ieee, layout}) {
        const d = requireDevice(ieee);
        if (!layout || typeof layout !== 'object' || !Array.isArray(layout.zones)) throw new Error('Invalid layout');
        layout = normalize(layout);
        if (ourConverter()?.code !== CONVERTER_CODE) throw new Error('Wait for the current converter to finish installing before saving');
        return runAction('saveLayout', async () => {
            const request = crypto.randomUUID();
            log('info', 'Writing zones and obstacle masks to sensor; waiting for readback');
            publish(BASE + '/' + d.friendly_name + '/set', {sensor_layout: {request, layout}});
            const result = await sensorResult(ieee, 'layout', request, 75000);
            if (result.status === 'timeout') throw new Error('No sensor confirmation. The sensor may be partially updated; re-save the complete layout to retry.');
            if (result.status !== 'verified') throw new Error(result.state.layout_error || 'Sensor layout verification failed. Re-save the complete layout to retry.');
            if (result.state.native_verification === 'acknowledged') log('info', 'Zone table too large to read back over this coordinator; every zone command was confirmed by the sensor instead');
            await z2mRequest('device/options', {id: ieee, options: {fp400_layout: JSON.stringify(layout), fp400_zone_mode: 'native', fp400_subscribe: false}});
            persisted.layouts[ieee] = layout;
            workflow.update(ieee, {zoneMode: 'native', sensorSavedAt: Date.now()});
            if (S.bridge.info?.config?.devices?.[ieee]) S.bridge.info.config.devices[ieee].fp400_layout = JSON.stringify(layout);
            persist();
            log('info', 'Zones and obstacles verified on sensor and layout backup saved');
            scheduleBroadcast();
        });
    },
};

/** Wait for the converter's result for one correlated request (`<prefix>_request` / `_status` / `_error`). */
function sensorResult(ieee, prefix, request, timeoutMs) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const timer = setInterval(() => {
            const state = S.states.get(ieee);
            if (state?.[`${prefix}_request`] === request) {
                clearInterval(timer);
                resolve({status: state[`${prefix}_status`] === 'verified' ? 'verified' : 'failed', state});
            } else if (Date.now() >= deadline) {
                clearInterval(timer);
                resolve({status: 'timeout', state});
            }
        }, 100);
    });
}

function requireDevice(ieee) {
    const device = S.devices.find((d) => d.ieee_address === ieee);
    if (!device) throw new Error('Device not found');
    return device;
}
const workflow = new Workflow({profiles: persisted.profiles, save: persist, changed: scheduleBroadcast, log,
    send: (ieee, payload) => {
        const d = requireDevice(ieee);
        if (!deviceUsesOurDefinition(d)) throw new Error('FP400 converter is not active');
        publish(`${BASE}/${d.friendly_name}/set`, payload);
    }});
function tickWorkflow() {
    workflow.tick(S.devices.filter(deviceUsesOurDefinition).map((d) => d.ieee_address));
}
setInterval(tickWorkflow, 1000);

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

// The ingress panel embeds this page in Home Assistant, so framing is intentionally not restricted here.
const SECURITY_HEADERS = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; form-action 'none'",
};

// Asset URLs carry a content hash so a browser (or the ingress iframe after a reload of Home Assistant only)
// can never combine a cached old script with a newer server.
const PUBLIC = path.join(HERE, 'public');
const BUILD = crypto.createHash('sha256')
    .update(['index.html', 'app.js', 'model.js', 'style.css'].map((f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8')).join('\0'))
    .digest('hex').slice(0, 12);
const versioned = {
    'index.html': (text) => text.replace('src="app.js"', `src="app.js?v=${BUILD}"`).replace('href="style.css"', `href="style.css?v=${BUILD}"`),
    'app.js': (text) => text.replace("from './model.js'", `from './model.js?v=${BUILD}'`),
};

const STATIC = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/icon.png': ['icon.png', 'image/png'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/model.js': ['model.js', 'text/javascript; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const server = http.createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    if (!allowed(req)) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400).end('Bad request'); return; }
    if (url.pathname === '/health') {
        res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({mqtt: S.mqtt.status, z2m: S.bridge.state}));
        return;
    }
    if (url.pathname === '/api/converter') {
        res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8', 'content-disposition': `attachment; filename="${CONVERTER_NAME}"`}).end(CONVERTER_CODE);
        return;
    }
    const entry = Object.hasOwn(STATIC, url.pathname) ? STATIC[url.pathname] : null;
    if (!entry) {
        res.writeHead(404).end('Not found');
        return;
    }
    const file = path.join(PUBLIC, entry[0]);
    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404).end('Not found');
            return;
        }
        const body = versioned[entry[0]] ? versioned[entry[0]](data.toString('utf8')) : data;
        res.writeHead(200, {'content-type': entry[1], 'cache-control': entry[0] === 'index.html' ? 'no-store' : 'no-cache'}).end(body);
    });
});

const wss = new WebSocketServer({noServer: true, maxPayload: 64 * 1024});
server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { socket.destroy(); return; }
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
    ws.on('close', () => { sockets.delete(ws); workflow.watch(ws, null); });
    ws.on('error', () => { sockets.delete(ws); ws.terminate(); });
    ws.on('message', async (data) => {
        let req;
        try {
            req = JSON.parse(data.toString());
        } catch {
            return;
        }
        if (!validRequest(req, actions)) {
            ws.send(JSON.stringify({type: 'result', id: req?.id ?? null, ok: false, error: 'Invalid request'}));
            return;
        }
        const fn = actions[req.op];
        const reply = (obj) => ws.readyState === 1 && ws.send(JSON.stringify({type: 'result', id: req.id, op: req.op, ...obj}));
        if (!fn) return reply({ok: false, error: `Unknown action ${req.op}`});
        const started = Date.now();
        try {
            if (req.op !== 'watch') log('info', `Request ${req.op}${req.ieee ? ` for sensor ${S.devices.findIndex((d) => d.ieee_address === req.ieee) + 1}` : ''}`);
            const data = await fn(req, ws);
            if (req.op !== 'watch') log('info', `${req.op} completed in ${Date.now() - started} ms`);
            reply({ok: true, data: data ?? null});
        } catch (err) {
            log('error', `${req.op} failed: ${err.message}`);
            reply({ok: false, error: redact(err.message)});
        }
    });
});

server.listen(PORT, () => {
    log('info', `FP400 Zones ${APP_VERSION} (converter ${CONVERTER_VERSION}) listening on port ${server.address().port} (${ADDON ? 'Home Assistant app' : 'Standalone'})`);
    connectMqtt();
});

for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
        client?.end(true);
        server.close();
        process.exit(0);
    });
}
