// Protocol unit tests: Zigbee2MQTT's expose/extend builders are stubbed here.
// This does not replace loading the converter in an actual Zigbee2MQTT instance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

function load() {
    const builder = new Proxy(() => builder, {get: () => builder});
    const code = fs.readFileSync(new URL('../converter/aqara-fp400-zones.mjs', import.meta.url), 'utf8')
        .replace(/^import .*;$/gm, '')
        .replace('export default {', 'const definition = {');
    const context = vm.createContext({Buffer, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
        m: builder, exposes: {presets: builder, access: {STATE: 1, SET: 2, ALL: 7}}});
    vm.runInContext(`${code}\nglobalThis.helpers = {parseLayout, parseLocation, cellOf, rt, tzFp400, fzOccupancy, fp400Extend, ATTR, encodeZone, nativeZones, clusterConfig};`, context);
    return context.helpers;
}

test('malformed layouts cannot crash the converter', () => {
    const {parseLayout} = load();
    for (const raw of ['null', '1', 'broken', '{"zones":[null,1,{}]}']) {
        assert.equal(parseLayout(raw).zones.length, 0);
    }
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
    const result = await nativeZones(ep, layout, 'write');
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
