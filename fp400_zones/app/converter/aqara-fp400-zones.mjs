/**
 * Aqara Spatial Multi-Sensor FP400 (lumi.models.4447_8295) – Zigbee2MQTT external converter with zones.
 *
 * What it does
 *   - presence (EP1), illuminance (EP2), live targets (x/y in cm) from the 0xFC0C location stream
 *   - software zones zone_1 … zone_8, computed from the targets and the layout drawn in the FP400 editor
 *     (stored as the device option `fp400_layout`, i.e. in configuration.yaml – no Aqara hub, no cloud)
 *   - mounting mode / side / height, region masks (monitoring exclusion, interference, entry/exit),
 *     AI background learning
 *   - EXPERIMENTAL: write the zones natively to the sensor (appendZone/removeZone, 0xFC0A cmd 0x04/0x08)
 *     and verify by reading attribute 0x0010 back.
 *
 * Protocol references (community research, not official Aqara documentation):
 *   - Koenkk/zigbee2mqtt#33146 (Zigbee frame captures, attribute discovery)
 *   - RAR/matterjs-server custom-clusters/aqara.ts and RAR/ha-aqara-fp400 const.py (Matter model of the same clusters)
 *
 * Grid: 16 columns x 20 rows of ~50 cm cells. Row 0 is nearest the sensor, column 8 straight ahead,
 * columns grow as x decreases. Bit = row * 16 + col of a 40 byte mask, most significant bit first.
 */
import * as m from 'zigbee-herdsman-converters/lib/modernExtend';
import * as exposes from 'zigbee-herdsman-converters/lib/exposes';

const e = exposes.presets;
const ea = exposes.access;

const CONVERTER_VERSION = '1.2.0';
const MFR = 0x115f;
const MO = {manufacturerCode: MFR};
const GRID_COLS = 16;
const GRID_ROWS = 20;
const MASK_BYTES = 40;
const CELL_CM = 50;
const MAX_ZONES = 8;
const SUBSCRIBE_SECONDS = 3600;
const SUBSCRIBE_RENEW_MS = 3300 * 1000;
const DEFAULT_TARGETS_INTERVAL_MS = 1000;

// ZCL data types (numeric, stable across herdsman versions)
const T = {BOOL: 0x10, MAP8: 0x18, U8: 0x20, U16: 0x21, U24: 0x22, U32: 0x23, I8: 0x28, I16: 0x29, I32: 0x2b,
    ENUM8: 0x30, ENUM16: 0x31, OCTET: 0x41, CHAR: 0x42, ARRAY: 0x48, STRUCT: 0x4c};

const CL_CONFIG = 'fp400Config';
const CL_RADAR = 'fp400Radar';
const CL_LOCATION = 'fp400Location';

const ATTR = {installMode: 0x00, sideInstall: 0x02, installHeight: 0x04, installStatus: 0x07, zones: 0x10, maxZones: 0x11,
    entryExitRegion: 0x12, interferenceRegion: 0x13, edgeRegion: 0x14};

const INSTALL_MODES = {wall: 1, ceiling: 2};
const SIDE_INSTALLS = {wall: 1, left_corner: 2, right_corner: 3};
const REGIONS = {region_monitoring: 'edgeRegion', region_interference: 'interferenceRegion', region_entry_exit: 'entryExitRegion'};
const ZONE_STATUS = ['success', 'invalid_argument', 'invalid_state', 'resource_exhausted', 'busy', 'duplicate_zone_id'];

// Commands are sent as plain byte sequences so the payload layout is fully under our control.
const byteParams = (n) => Array.from({length: n}, (_, i) => ({name: `b${i}`, type: T.U8}));
const toByteObject = (buf) => Object.fromEntries([...buf].map((v, i) => [`b${i}`, v]));
const attrDefs = (defs) => Object.fromEntries(Object.entries(defs).map(([name, d]) => [name, {name, ...d}]));
const cmdDefs = (defs) => Object.fromEntries(Object.entries(defs).map(([name, d]) => [name, {name, ...d}]));

const clusterConfig = {
    ID: 0xfc0a,
    name: CL_CONFIG,
    manufacturerCode: MFR,
    attributes: attrDefs({
        installMode: {ID: ATTR.installMode, type: T.ENUM8, write: true},
        sideInstall: {ID: ATTR.sideInstall, type: T.ENUM8, write: true},
        installHeight: {ID: ATTR.installHeight, type: T.U16, write: true},
        installStatus: {ID: ATTR.installStatus, type: T.ENUM8},
        zones: {ID: ATTR.zones, type: T.ARRAY},
        maxZones: {ID: ATTR.maxZones, type: T.U8},
        entryExitRegion: {ID: ATTR.entryExitRegion, type: T.OCTET, write: true},
        interferenceRegion: {ID: ATTR.interferenceRegion, type: T.OCTET, write: true},
        edgeRegion: {ID: ATTR.edgeRegion, type: T.OCTET, write: true},
    }),
    commands: cmdDefs({
        learn: {ID: 0x03, parameters: []},
        appendZoneTyped: {ID: 0x04, parameters: byteParams(51)},
        appendZonePlain: {ID: 0x04, parameters: byteParams(50)},
        removeZoneTyped: {ID: 0x08, parameters: byteParams(2)},
        removeZonePlain: {ID: 0x08, parameters: byteParams(1)},
    }),
    commandsResponse: {},
};

const clusterRadar = {
    ID: 0xfc0b,
    name: CL_RADAR,
    manufacturerCode: MFR,
    attributes: attrDefs({zoneId: {ID: 0x01, type: T.U8}, humanCount: {ID: 0x02, type: T.U16}}),
    commands: {},
    commandsResponse: {},
};

const clusterLocation = {
    ID: 0xfc0c,
    name: CL_LOCATION,
    manufacturerCode: MFR,
    attributes: attrDefs({maxTargets: {ID: 0x00, type: T.U8}, activity: {ID: 0x07, type: T.ENUM8}}),
    commands: cmdDefs({subscribe: {ID: 0x00, parameters: [{name: 'timeout', type: T.U16}]}}),
    commandsResponse: {},
};

// ---------------------------------------------------------------------------------------------------------------
// Protocol helpers

function hexToMask(value) {
    if (value === '' || value === 'clear' || value == null) return Buffer.alloc(MASK_BYTES);
    if (Buffer.isBuffer(value)) value = value.toString('hex');
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{80}$/.test(value)) {
        throw new Error('Mask must be 80 hex characters (40 bytes, 16x20 grid)');
    }
    return Buffer.from(value, 'hex');
}

function maskHas(mask, bit) {
    return Boolean(mask[bit >> 3] & (0x80 >> (bit & 7)));
}

function maskCount(mask) {
    let n = 0;
    for (let bit = 0; bit < GRID_COLS * GRID_ROWS; bit++) if (maskHas(mask, bit)) n++;
    return n;
}

/** Target position (cm) -> {row, col, bit} or null when outside the grid. */
function cellOf(x, y) {
    const row = Math.floor(y / CELL_CM);
    const col = Math.floor(8 - x / CELL_CM);
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return null;
    return {row, col, bit: row * GRID_COLS + col};
}

function readTyped(buf, off, type) {
    const need = (n) => {
        if (off + n > buf.length) throw new RangeError('truncated');
    };
    switch (type) {
        case T.BOOL:
        case T.MAP8:
        case T.U8:
        case T.ENUM8:
            need(1);
            return [buf[off], off + 1];
        case T.I8:
            need(1);
            return [buf.readInt8(off), off + 1];
        case T.U16:
        case T.ENUM16:
            need(2);
            return [buf.readUInt16LE(off), off + 2];
        case T.I16:
            need(2);
            return [buf.readInt16LE(off), off + 2];
        case T.U24:
            need(3);
            return [buf.readUIntLE(off, 3), off + 3];
        case T.U32:
            need(4);
            return [buf.readUInt32LE(off), off + 4];
        case T.I32:
            need(4);
            return [buf.readInt32LE(off), off + 4];
        case T.OCTET:
        case T.CHAR: {
            need(1);
            const len = buf[off];
            need(1 + len);
            return [buf.subarray(off + 1, off + 1 + len), off + 1 + len];
        }
        default:
            throw new TypeError(`unsupported type 0x${type.toString(16)}`);
    }
}

/** Split a raw ZCL frame into header fields and payload. */
function splitFrame(data) {
    if (!Buffer.isBuffer(data) || data.length < 3) return null;
    const fc = data[0];
    const o = fc & 0x04 ? 3 : 1;
    if (data.length < o + 2) return null;
    return {frameType: fc & 0x03, manufacturer: fc & 0x04 ? data.readUInt16LE(1) : undefined, cmd: data[o + 1], payload: data.subarray(o + 2)};
}

/**
 * Location notification (global cmd 0x8B on 0xFC0C):
 *   u16 eventId (0 = location info) | 0x4C | u16 count | count x { u16 memberCount | memberCount x (type, value) }
 * Member 0 = target id, 1 = x (cm, int16), 2 = y (cm, int16); the rest is kept raw.
 */
function parseLocation(payload) {
    if (!Buffer.isBuffer(payload) || payload.length < 5) return null;
    if (payload.readUInt16LE(0) !== 0 || payload[2] !== T.STRUCT) return null;
    const declared = payload.readUInt16LE(3);
    let off = 5;
    const targets = [];
    let truncated = false;
    for (let i = 0; i < declared; i++) {
        try {
            if (off + 2 > payload.length) throw new RangeError('truncated');
            const members = payload.readUInt16LE(off);
            off += 2;
            const values = [];
            for (let j = 0; j < members; j++) {
                if (off >= payload.length) throw new RangeError('truncated');
                const type = payload[off++];
                const [value, next] = readTyped(payload, off, type);
                values.push(value);
                off = next;
            }
            if (values.length >= 3) targets.push({id: values[0], x: values[1], y: values[2], extra: values.slice(3)});
        } catch {
            truncated = true;
            break;
        }
    }
    return {declared, targets, truncated};
}

/** Zone struct as used by appendZone: {u8 id, u8 type, octstr cells, bool enabled}. */
function encodeZone(zone, typed) {
    const body = Buffer.concat([
        Buffer.from([0x04, 0x00, T.U8, zone.id, T.U8, zone.type ?? 0, T.OCTET, MASK_BYTES]),
        zone.mask,
        Buffer.from([T.BOOL, zone.enabled === false ? 0 : 1]),
    ]);
    return typed ? Buffer.concat([Buffer.from([T.STRUCT]), body]) : body;
}

function decodeNativeZones(value) {
    if (!Array.isArray(value)) return null;
    const out = [];
    for (const item of value) {
        let fields = item;
        if (item && !Array.isArray(item) && typeof item === 'object') fields = Object.values(item);
        if (!Array.isArray(fields)) continue;
        const val = (f) => (f && typeof f === 'object' && 'elmVal' in f ? f.elmVal : f);
        const id = val(fields[0]);
        const cells = val(fields[2]);
        const enabled = val(fields[3]);
        out.push({id, cells: Buffer.isBuffer(cells) ? cells.toString('hex') : null, enabled: enabled === undefined ? null : Boolean(enabled)});
    }
    return out;
}

const layoutCache = new Map();

/** Device option `fp400_layout` (JSON string or object) -> normalized layout. */
function parseLayout(raw) {
    if (raw == null || raw === '') return {zones: [], targetsInterval: DEFAULT_TARGETS_INTERVAL_MS};
    const cacheKey = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (layoutCache.has(cacheKey)) return layoutCache.get(cacheKey);
    let doc;
    try {
        doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        doc = {};
    }
    if (!doc || typeof doc !== 'object') doc = {};
    const zones = [];
    for (const z of Array.isArray(doc.zones) ? doc.zones : []) {
        if (!z || typeof z !== 'object') continue;
        const id = Number(z.id);
        if (!Number.isInteger(id) || id < 1 || id > MAX_ZONES) continue;
        let mask;
        try {
            mask = hexToMask(z.cells);
        } catch {
            continue;
        }
        zones.push({id, name: String(z.name ?? `Zone ${id}`), enabled: z.enabled !== false, delay: Math.max(0, Number(z.delay) || 0),
            type: Number(z.type) || 0, mask});
    }
    const interval = doc.targets_interval === undefined ? DEFAULT_TARGETS_INTERVAL_MS : Number(doc.targets_interval);
    const layout = {zones, targetsInterval: Number.isFinite(interval) ? interval : DEFAULT_TARGETS_INTERVAL_MS};
    if (layoutCache.size > 32) layoutCache.clear();
    layoutCache.set(cacheKey, layout);
    return layout;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-device runtime state (zone hold timers, publish throttling)

const runtime = new Map();

function rt(device) {
    const key = device.ieeeAddr;
    if (!runtime.has(key)) {
        runtime.set(key, {zones: new Array(MAX_ZONES + 1).fill(false), timers: new Array(MAX_ZONES + 1).fill(null),
            lastTargets: 0, lastCount: undefined, lastSubscribe: 0, publish: null});
    }
    return runtime.get(key);
}

function evaluateZones(r, layout, targets) {
    const changes = {};
    const active = new Set();
    for (const zone of layout.zones) {
        if (!zone.enabled) continue;
        active.add(zone.id);
        const key = `zone_${zone.id}`;
        const inside = targets.some((t) => t.cell && maskHas(zone.mask, t.cell.bit));
        if (inside) {
            if (r.timers[zone.id]) {
                clearTimeout(r.timers[zone.id]);
                r.timers[zone.id] = null;
            }
            if (!r.zones[zone.id]) {
                r.zones[zone.id] = true;
                changes[key] = true;
            }
        } else if (r.zones[zone.id] && !r.timers[zone.id]) {
            if (zone.delay <= 0) {
                r.zones[zone.id] = false;
                changes[key] = false;
            } else {
                r.timers[zone.id] = setTimeout(() => {
                    r.timers[zone.id] = null;
                    r.zones[zone.id] = false;
                    r.publish?.({[key]: false});
                }, zone.delay * 1000);
            }
        }
    }
    for (let id = 1; id <= MAX_ZONES; id++) {
        if (!active.has(id) && r.zones[id]) {
            if (r.timers[id]) clearTimeout(r.timers[id]);
            r.timers[id] = null;
            r.zones[id] = false;
            changes[`zone_${id}`] = false;
        }
    }
    return changes;
}

function clearZones(r) {
    const changes = {};
    for (let id = 1; id <= MAX_ZONES; id++) {
        if (r.timers[id]) clearTimeout(r.timers[id]);
        r.timers[id] = null;
        if (r.zones[id]) {
            r.zones[id] = false;
            changes[`zone_${id}`] = false;
        }
    }
    return changes;
}

function maybeSubscribe(device, options, r, logger) {
    if (options?.fp400_subscribe !== true) return;
    const now = Date.now();
    if (now - r.lastSubscribe < SUBSCRIBE_RENEW_MS) return;
    r.lastSubscribe = now;
    const ep = device.getEndpoint(1);
    ep?.command(CL_LOCATION, 'subscribe', {timeout: SUBSCRIBE_SECONDS}, {...MO, disableDefaultResponse: true})
        .catch((err) => logger?.debug?.(`FP400 location subscribe failed: ${err.message}`));
}

const readAttr = (res, name) => res?.[name] ?? res?.[ATTR[name]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keyOf = (map, value) => Object.keys(map).find((k) => map[k] === value);

async function writeVerify(ep, name, type, value) {
    await ep.write(CL_CONFIG, {[ATTR[name]]: {value, type}}, MO);
    const back = readAttr(await ep.read(CL_CONFIG, [name], MO), name);
    const same = Buffer.isBuffer(value) ? Buffer.isBuffer(back) && back.equals(value) : back === value;
    if (!same) throw new Error(`FP400: ${name} readback mismatch (wrote ${Buffer.isBuffer(value) ? value.toString('hex') : value}, read ${Buffer.isBuffer(back) ? back.toString('hex') : back})`);
    return back;
}

async function readNativeZones(ep) {
    try {
        const res = await ep.read(CL_CONFIG, ['zones'], MO);
        const zones = decodeNativeZones(readAttr(res, 'zones'));
        return zones ?? 'unreadable';
    } catch (err) {
        return `unreadable: ${err.message}`;
    }
}

async function nativeZones(ep, layout, action, encoding) {
    const typed = encoding !== 'plain';
    const errors = [];
    const send = async (cmd, buf) => {
        try {
            await ep.command(CL_CONFIG, cmd, toByteObject(buf), {...MO, disableDefaultResponse: true});
        } catch (err) {
            errors.push(`${cmd}: ${err.message}`);
        }
        await sleep(400);
    };
    const wanted = action === 'clear' ? [] : layout.zones.filter((z) => z.enabled && maskCount(z.mask) > 0);
    const wantedIds = new Set(wanted.map((z) => z.id));
    if (action !== 'read') {
        for (let id = 1; id <= MAX_ZONES; id++) {
            if (!wantedIds.has(id)) await send(typed ? 'removeZoneTyped' : 'removeZonePlain', typed ? Buffer.from([T.U8, id]) : Buffer.from([id]));
        }
        for (const zone of wanted) await send(typed ? 'appendZoneTyped' : 'appendZonePlain', encodeZone(zone, typed));
        await sleep(1500);
    }
    const back = await readNativeZones(ep);
    let sync = 'unreadable';
    if (Array.isArray(back)) {
        if (action === 'read') {
            sync = 'read';
        } else {
            const ok = errors.length === 0 && back.length === wanted.length && wanted.every((z) => back.some((b) => b.id === z.id && b.cells === z.mask.toString('hex') && b.enabled === z.enabled));
            sync = ok ? 'verified' : 'mismatch';
        }
    }
    return {native_zones: Array.isArray(back) ? back.map((z) => ({id: z.id, enabled: z.enabled, cells: z.cells})) : [],
        native_layout: sync === 'verified' ? wanted.map((z) => `${z.id}:${z.mask.toString('hex')}`).sort().join('|') : null,
        native_sync: sync, native_errors: errors.length ? errors.slice(0, 4).join('; ') : (typeof back === 'string' ? back : null), native_encoding: typed ? 'typed' : 'plain'};
}

// ---------------------------------------------------------------------------------------------------------------
// fromZigbee

const fzOccupancy = {
    cluster: 'msOccupancySensing',
    type: ['attributeReport', 'readResponse'],
    convert: (model, msg, publish, options, meta) => {
        if (msg.data.occupancy === undefined) return;
        const occupied = (msg.data.occupancy & 1) === 1;
        const ep = msg.endpoint.ID;
        if (ep === 1) {
            const r = rt(msg.device);
            r.publish = publish;
            maybeSubscribe(msg.device, options, r, meta?.logger);
            const out = {presence: occupied};
            if (!occupied && options?.fp400_zone_mode !== 'native') {
                Object.assign(out, clearZones(r));
                out.target_count = 0;
                out.targets = [];
                r.lastCount = 0;
            }
            return out;
        }
        if (ep >= 3 && ep <= 10) return {[`native_zone_${ep - 2}`]: occupied,
            ...(options?.fp400_zone_mode === 'native' ? {[`zone_${ep - 2}`]: occupied} : {})};
    },
};

const fzLocationRaw = {
    cluster: CL_LOCATION,
    type: ['raw'],
    convert: (model, msg, publish, options, meta) => {
        const frame = splitFrame(msg.data);
        if (!frame || frame.cmd !== 0x8b) return;
        const parsed = parseLocation(frame.payload);
        if (!parsed) return;
        const r = rt(msg.device);
        r.publish = publish;
        maybeSubscribe(msg.device, options, r, meta?.logger);
        const layout = parseLayout(options?.fp400_layout);
        const targets = parsed.targets.map((t) => ({id: t.id, x: t.x, y: t.y, cell: cellOf(t.x, t.y)}));
        const out = options?.fp400_zone_mode === 'native' ? {} : evaluateZones(r, layout, targets);
        const count = Math.max(parsed.declared, targets.length);
        if (count !== r.lastCount) {
            out.target_count = count;
            r.lastCount = count;
        }
        const now = Date.now();
        const interval = layout.targetsInterval;
        if (interval >= 0 && (Object.keys(out).length > 0 || now - r.lastTargets >= interval)) {
            out.targets = targets.map((t) => ({id: t.id, x: t.x, y: t.y, row: t.cell?.row ?? null, col: t.cell?.col ?? null}));
            out.targets_updated_at = now;
            if (parsed.truncated) out.targets_truncated = true;
            r.lastTargets = now;
        }
        return Object.keys(out).length ? out : undefined;
    },
};

const fzConfigRaw = {
    cluster: CL_CONFIG,
    type: ['raw'],
    convert: (model, msg) => {
        const frame = splitFrame(msg.data);
        if (!frame) return;
        const p = frame.payload;
        if (frame.cmd === 0x8b && p.length >= 3 && p.readUInt16LE(0) === 0x0003) {
            return {background_learning_result: p[2] === 0 ? 'success' : `error_${p[2]}`};
        }
        if (frame.frameType === 1 && [0x05, 0x07, 0x09, 0x0b].includes(frame.cmd) && p.length >= 1) {
            const status = p.length >= 2 && p[0] === T.ENUM8 ? p[1] : p[0];
            const command = {5: 'append', 7: 'update', 9: 'remove', 11: 'set'}[frame.cmd];
            return {native_zone_result: `${command}: ${ZONE_STATUS[status] ?? `status_${status}`}`};
        }
    },
};

const fzConfigAttr = {
    cluster: CL_CONFIG,
    type: ['attributeReport', 'readResponse'],
    convert: (model, msg) => {
        const out = {};
        const d = msg.data;
        const v = (name) => d[name] ?? d[ATTR[name]];
        if (v('installMode') !== undefined) out.install_mode = keyOf(INSTALL_MODES, v('installMode')) ?? 'unknown';
        if (v('sideInstall') !== undefined) out.side_install = keyOf(SIDE_INSTALLS, v('sideInstall')) ?? 'unknown';
        if (v('installHeight') !== undefined) out.install_height = v('installHeight');
        for (const [key, name] of Object.entries(REGIONS)) {
            const value = v(name);
            if (Buffer.isBuffer(value)) out[key] = value.length ? value.toString('hex') : '0'.repeat(80);
        }
        return Object.keys(out).length ? out : undefined;
    },
};

// ---------------------------------------------------------------------------------------------------------------
// toZigbee

const tzFp400 = {
    key: ['install_mode', 'side_install', 'install_height', 'region_monitoring', 'region_interference', 'region_entry_exit',
        'background_learning', 'location_subscribe', 'native_zones'],
    convertSet: async (entity, key, value, meta) => {
        const ep = meta.device.getEndpoint(1);
        switch (key) {
            case 'install_mode': {
                if (!(value in INSTALL_MODES)) throw new Error(`install_mode must be one of ${Object.keys(INSTALL_MODES).join(', ')}`);
                await writeVerify(ep, 'installMode', T.ENUM8, INSTALL_MODES[value]);
                return {state: {install_mode: value}};
            }
            case 'side_install': {
                if (!(value in SIDE_INSTALLS)) throw new Error(`side_install must be one of ${Object.keys(SIDE_INSTALLS).join(', ')}`);
                await writeVerify(ep, 'sideInstall', T.ENUM8, SIDE_INSTALLS[value]);
                return {state: {side_install: value}};
            }
            case 'install_height': {
                const mm = Math.round(Number(value));
                if (!Number.isFinite(mm) || mm < 0 || mm > 5000) throw new Error('install_height must be 0..5000 mm');
                await writeVerify(ep, 'installHeight', T.U16, mm);
                return {state: {install_height: mm}};
            }
            case 'region_monitoring':
            case 'region_interference':
            case 'region_entry_exit': {
                const mask = hexToMask(value);
                await writeVerify(ep, REGIONS[key], T.OCTET, mask);
                return {state: {[key]: mask.toString('hex')}};
            }
            case 'background_learning': {
                await ep.command(CL_CONFIG, 'learn', {}, MO);
                return {state: {background_learning_result: 'running'}};
            }
            case 'location_subscribe': {
                const seconds = value === 'start' ? SUBSCRIBE_SECONDS : Number(value);
                if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('Stream duration must be 1..3600 seconds');
                await ep.command(CL_LOCATION, 'subscribe', {timeout: seconds}, {...MO, disableDefaultResponse: true});
                rt(meta.device).lastSubscribe = Date.now();
                return {};
            }
            case 'native_zones': {
                const [action, encoding] = String(value).split('_');
                if (!['write', 'clear', 'read'].includes(action)) throw new Error('native_zones must be write, write_plain, clear, clear_plain or read');
                const layout = parseLayout(meta.options?.fp400_layout);
                return {state: await nativeZones(ep, layout, action, encoding)};
            }
        }
    },
    convertGet: async (entity, key, meta) => {
        const ep = meta.device.getEndpoint(1);
        if (key === 'install_mode') await ep.read(CL_CONFIG, ['installMode'], MO);
        else if (key === 'side_install') await ep.read(CL_CONFIG, ['sideInstall'], MO);
        else if (key === 'install_height') await ep.read(CL_CONFIG, ['installHeight'], MO);
        else if (key in REGIONS) await ep.read(CL_CONFIG, [REGIONS[key]], MO);
    },
};

// ---------------------------------------------------------------------------------------------------------------
// Definition

const fp400Extend = {
    isModernExtend: true,
    fromZigbee: [fzOccupancy, fzLocationRaw, fzConfigRaw, fzConfigAttr],
    toZigbee: [tzFp400],
    exposes: [
        e.binary('presence', ea.STATE, true, false).withDescription('Presence in the detection area'),
        e.numeric('target_count', ea.STATE).withDescription('Number of reported targets'),
        ...Array.from({length: MAX_ZONES}, (_, i) =>
            e.binary(`zone_${i + 1}`, ea.STATE, true, false).withLabel(`Zone ${i + 1}`)
                .withDescription('Zone occupancy (software or verified native mode)')),
        e.enum('install_mode', ea.ALL, Object.keys(INSTALL_MODES)).withDescription('Mounting type'),
        e.enum('side_install', ea.ALL, Object.keys(SIDE_INSTALLS)).withDescription('Wall position: flat wall or corner'),
        e.numeric('install_height', ea.ALL).withUnit('mm').withValueMin(0).withValueMax(5000).withDescription('Mounting height'),
        e.enum('background_learning', ea.SET, ['start']).withDescription('Start background learning (room must be empty)'),
    ],
    options: [
        e.enum('fp400_zone_mode', ea.SET, ['software', 'native']).withDescription('Software zones need continuous positions; native mode requires verified sensor zones.'),
        e.text('fp400_layout', ea.SET).withDescription('Zone layout (JSON), managed by FP400 Zones.'),
        e.binary('fp400_subscribe', ea.SET, true, false)
            .withDescription('Legacy continuous stream renewal. Leave disabled when the app manages viewing sessions.'),
    ],
    configure: [
        async (device, coordinatorEndpoint) => {
            const ep1 = device.getEndpoint(1);
            await ep1.bind('msOccupancySensing', coordinatorEndpoint);
            await ep1.configureReporting('msOccupancySensing', [
                {attribute: 'occupancy', minimumReportInterval: 0, maximumReportInterval: 3600, reportableChange: 0},
            ]);
            for (const cluster of [0xfc0a, 0xfc0c]) {
                try {
                    await ep1.bind(cluster, coordinatorEndpoint);
                } catch {
                    // not all firmware accepts binds on the manufacturer clusters; the stream also works without
                }
            }
            // A sensor that was never set up in the Aqara app has no mounting configuration and does not stream
            // positions. Writing a mounting mode enables the stream (#33146). Existing settings are left alone.
            try {
                const res = await ep1.read(CL_CONFIG, ['installMode', 'sideInstall'], MO);
                if (!readAttr(res, 'installMode')) await ep1.write(CL_CONFIG, {[ATTR.installMode]: {value: 1, type: T.ENUM8}}, MO);
                if (!readAttr(res, 'sideInstall')) await ep1.write(CL_CONFIG, {[ATTR.sideInstall]: {value: 1, type: T.ENUM8}}, MO);
            } catch {
                // ignore, can be set later from the editor
            }
        },
    ],
};

export default {
    zigbeeModel: ['lumi.models.4447_8295'],
    model: 'PS-S05D',
    vendor: 'Aqara',
    description: 'Spatial multi-sensor FP400 (FP400 Zones)',
    // Z2M reconfigures the device automatically when this version changes.
    version: CONVERTER_VERSION,
    extend: [
        m.deviceAddCustomCluster(CL_CONFIG, clusterConfig),
        m.deviceAddCustomCluster(CL_RADAR, clusterRadar),
        m.deviceAddCustomCluster(CL_LOCATION, clusterLocation),
        m.illuminance(),
        m.identify(),
        fp400Extend,
    ],
};
