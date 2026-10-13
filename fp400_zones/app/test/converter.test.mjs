// Protocol unit tests: Zigbee2MQTT's expose/extend builders are stubbed here.
// This does not replace loading the converter in an actual Zigbee2MQTT instance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

function load(timers = {}) {
    const builder = new Proxy(() => builder, {get: () => builder});
    const code = fs.readFileSync(new URL('../converter/aqara-fp400-zones.mjs', import.meta.url), 'utf8')
        .replace(/^import .*;$/gm, '')
        .replace('export default {', 'const definition = {');
    const context = vm.createContext({Buffer, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout, ...timers,
        logger: {warning: () => {}}, m: builder, exposes: {presets: builder, access: {STATE: 1, SET: 2, ALL: 7}}});
    vm.runInContext(`${code}\nglobalThis.helpers = {parseLayout, parseLocation, cellOf, rt, tzFp400, fzOccupancy, fp400Extend, ATTR, encodeZone, nativeZones, clusterConfig, pollMissingZones};`, context);
    return context.helpers;
}

test('malformed layouts cannot crash the converter', () => {
    const {parseLayout} = load();
    for (const raw of ['null', '1', 'broken', '{"zones":[null,1,{}]}']) {
        assert.equal(parseLayout(raw).zones.length, 0);
    }
});

test('reporting exhaustion does not prevent configuration of later zone endpoints', async () => {
    const {fp400Extend} = load();
    const bound = [];
    const endpoints = new Map(Array.from({length: 10}, (_, i) => [i + 1, {
        inputClusters: [0x0406], bind: async () => { bound.push(i + 1); },
        configureReporting: async () => { if (i >= 5) throw new Error('INSUFFICIENT_SPACE'); },
        read: async () => ({installMode: 1, sideInstall: 1}),
    }]));
    await fp400Extend.configure[0]({getEndpoint: (id) => endpoints.get(id)}, {});
    assert.ok(bound.includes(10));
    endpoints.get(6).configureReporting = async () => { throw new Error('Device unavailable'); };
    await assert.rejects(fp400Extend.configure[0]({getEndpoint: (id) => endpoints.get(id)}, {}), /unavailable/);
});

test('fallback reads only enabled, nonempty sensor zones without reporting and continues after failure', async () => {
    const {pollMissingZones} = load();
    const reads = [];
    const cells = '80' + '00'.repeat(39);
    const options = {fp400_layout: {zones: [1, 2, 3, 4, 5].map(id => ({id, cells: id === 3 ? '00'.repeat(40) : cells, enabled: id !== 2}))}};
    const device = {getEndpoint: (id) => ({
        configuredReportings: id === 3 ? [{cluster: {ID: 0x0406}, attribute: {ID: 0}, maximumReportInterval: 3600}] : [],
        read: async (cluster, attrs) => { reads.push([id, cluster, ...attrs]); if (id === 6) throw new Error('timeout'); },
    })};
    assert.equal(await pollMissingZones(device, options), true);
    assert.deepEqual(reads, [[6, 'msOccupancySensing', 'occupancy'], [7, 'msOccupancySensing', 'occupancy']]);
});

test('native polling uses current options, does not duplicate timers, and stops cleanly', async () => {
    const scheduled = new Map(); let next = 0; const reads = [];
    const {fp400Extend} = load({setTimeout: (fn, ms) => { scheduled.set(++next, {fn, ms}); return next; }, clearTimeout: (id) => scheduled.delete(id)});
    const event = fp400Extend.onEvent[1];
    const device = {ieeeAddr: 'poll-device', getEndpoint: (id) => ({read: async () => { reads.push(id); }})};
    const options = {fp400_layout: {zones: [{id: 4, cells: '80' + '00'.repeat(39)}]}};
    event({type: 'start', data: {device, options}});
    event({type: 'deviceAnnounce', data: {device, options}});
    assert.equal(scheduled.size, 1);
    const first = scheduled.get(1); scheduled.delete(1); await first.fn();
    assert.deepEqual(reads, [6]);
    assert.equal(scheduled.get(2).ms, 10000);
    event({type: 'deviceOptionsChanged', data: {device, options: {fp400_layout: {zones: []}}}});
    const second = scheduled.get(2); scheduled.delete(2); await second.fn();
    assert.deepEqual(reads, [6]);
    event({type: 'stop', data: {ieeeAddr: device.ieeeAddr}});
    assert.equal(scheduled.size, 0);
});

test('view subscriptions expire and occupancy always comes from the sensor', async () => {
    const {tzFp400, fzOccupancy} = load();
    const commands = [];
    const device = {ieeeAddr: 'example-device', getEndpoint: () => ({command: async (...args) => commands.push(args)})};
    await tzFp400.convertSet(null, 'location_subscribe', 60, {device});
    assert.equal(commands[0][2].timeout, 60);
    for (const value of [0, -1, 3601, 'bad']) await assert.rejects(tzFp400.convertSet(null, 'location_subscribe', value, {device}));
    const msg = {data: {occupancy: 1}, endpoint: {ID: 3}, device};
    assert.equal(fzOccupancy.convert(null, msg, () => {}, {}).zone_1, true);
    assert.equal(fzOccupancy.convert(null, msg, () => {}, {fp400_zone_mode: 'native'}).zone_1, true);
    msg.data.occupancy = 0;
    assert.equal(fzOccupancy.convert(null, msg, () => {}, {fp400_zone_mode: 'native'}).zone_1, false);
});

test('grid boundaries and truncated location reports are handled', () => {
    const {cellOf, parseLocation} = load();
    assert.equal(cellOf(0, 0).bit, 8);
    for (const [x, y] of [[0, -1], [0, 1000], [401, 0], [-400, 0]]) assert.equal(cellOf(x, y), null);
    assert.equal(parseLocation(Buffer.alloc(4)), null);
    const frame = Buffer.from([0, 0, 0x4c, 1, 0]);
    assert.equal(parseLocation(frame).truncated, true);
});


test('saving confirms all masks and correlates sensor failure without claiming success', async () => {
    const {tzFp400, ATTR} = load();
    const written = new Map();
    let fail = false;
    const ep = {command: async () => {}, write: async (cluster, attrs) => {
        if (fail) throw new Error('Sensor rejected mask');
        for (const [id, item] of Object.entries(attrs)) written.set(Number(id), item.value);
    }, read: async (cluster, names) => names[0] === 'zones' ? {zones: []} : {[names[0]]: written.get(ATTR[names[0]])}};
    const meta = {device: {getEndpoint: () => ep}};
    const value = {request: 'new-request', layout: {zones: [], regions: {monitoring: '80' + '00'.repeat(39)}}};
    const success = (await tzFp400.convertSet(null, 'sensor_layout', value, meta)).state;
    assert.equal(success.layout_status, 'verified');
    assert.equal(success.layout_request, value.request);
    assert.equal(written.size, 3);
    assert.equal(written.get(ATTR.edgeRegion).toString('hex'), value.layout.regions.monitoring);
    fail = true;
    const failure = (await tzFp400.convertSet(null, 'sensor_layout', {...value, request: 'second'}, meta)).state;
    assert.equal(failure.layout_status, 'failed');
    assert.equal(failure.layout_request, 'second');
    assert.match(failure.layout_error, /rejected/);
});

test('changing layout names requests a device-specific expose refresh', async () => {
    const {fp400Extend} = load();
    let updates = 0;
    await fp400Extend.onEvent[0]({type: 'deviceOptionsChanged', data: {from: {fp400_layout: 'old'}, to: {fp400_layout: 'new'}, deviceExposesChanged: () => updates++}});
    assert.equal(updates, 1);
    await fp400Extend.onEvent[0]({type: 'deviceOptionsChanged', data: {from: {}, to: {}, deviceExposesChanged: () => updates++}});
    assert.equal(updates, 1);
});

test('native zone wire format uses enum8 zone type and no outer STRUCT tag', () => {
    const {encodeZone, clusterConfig} = load();
    const mask = Buffer.alloc(40, 0x80);
    const bytes = encodeZone({id: 3, type: 0, mask, enabled: true});
    assert.equal(bytes.toString('hex'), '0400200330004128' + mask.toString('hex') + '1001');
    assert.equal(bytes.length, clusterConfig.commands.appendZonePlain.parameters.length);
    assert.equal(clusterConfig.commands.removeZonePlain.parameters.length, 1);
});

test('native transfer sends plain IDs and verifies a nonempty wrapped ZCL zone table', async () => {
    const {nativeZones, parseLayout} = load();
    const cells = '80' + '00'.repeat(39);
    const layout = parseLayout({zones: [{id: 2, cells, enabled: true}]});
    const sent = [];
    const ep = {command: async (cluster, command, data) => sent.push({command, bytes: Buffer.from(Object.values(data))}),
        read: async () => ({zones: [[{elmType: 0x20, elmVal: 2}, {elmType: 0x30, elmVal: 0}, {elmType: 0x41, elmVal: Buffer.from(cells, 'hex')}, {elmType: 0x10, elmVal: 1}]]})};
    const delayWrites = [];
    const device = {getEndpoint: (id) => ({write: async (cluster, attrs) => delayWrites.push([id, cluster, attrs[3]]), read: async () => ({3: 0})})};
    const result = await nativeZones(ep, layout, 'write', device);
    assert.equal(delayWrites.length, 1);
    assert.equal(delayWrites[0][0], 4);
    assert.equal(delayWrites[0][1], 'msOccupancySensing');
    assert.equal(delayWrites[0][2].value, 0);
    assert.equal(delayWrites[0][2].type, 0x21);
    assert.equal(result.native_sync, 'verified');
    assert.equal(sent.length, 9);
    for (let i = 0; i < 8; i++) { assert.equal(sent[i].command, 'removeZonePlain'); assert.deepEqual([...sent[i].bytes], [i + 1]); }
    assert.equal(sent[8].command, 'appendZonePlain');
    assert.equal(sent[8].bytes.toString('hex'), '0400200230004128' + cells + '1001');
    ep.read = async () => ({zones: []});
    const failure = await nativeZones(ep, layout, 'write');
    assert.equal(failure.native_sync, 'mismatch');
    assert.match(failure.native_errors, /requested 1, received 0/);
});

test('saving sets all eight zone timeouts and fails on rejected or missing confirmation', async () => {
    const {tzFp400, ATTR} = load();
    const cells = '80' + '00'.repeat(39);
    const zones = Array.from({length: 8}, (_, i) => ({id: i + 1, cells, enabled: true, delay: 5}));
    const writes = [];
    const masks = new Map();
    let mode = 'ok';
    const control = {command: async () => {}, write: async (cluster, attrs) => {
        for (const [key, item] of Object.entries(attrs)) masks.set(Number(key), item.value);
    }, read: async (cluster, names) => names[0] === 'zones' ? {zones: zones.map(z => [
        {elmVal: z.id}, {elmVal: 0}, {elmVal: Buffer.from(cells, 'hex')}, {elmVal: 1},
    ])} : {[names[0]]: masks.get(ATTR[names[0]])}};
    const device = {getEndpoint: id => id === 1 ? control : {
        write: async (cluster, attrs) => {
            assert.equal(cluster, 'msOccupancySensing');
            assert.equal(attrs[3].value, 0);
            writes.push(id);
            if (mode === 'reject' && id === 6) throw new Error('Rejected');
        },
        read: async () => id === 6 && mode === 'missing' ? {} : {3: id === 6 && mode === 'mismatch' ? 10 : 0},
    }};
    for (mode of ['ok', 'reject', 'missing', 'mismatch']) {
        writes.length = 0;
        const result = (await tzFp400.convertSet(null, 'sensor_layout', {request: mode, layout: {zones}}, {device})).state;
        assert.equal(result.layout_request, mode);
        assert.equal(result.layout_status, mode === 'ok' ? 'verified' : 'failed');
        assert.deepEqual(writes, [3, 4, 5, 6, 7, 8, 9, 10]);
        if (mode !== 'ok') assert.match(result.layout_error, /Zone 4 absence confirmation/);
    }
});
