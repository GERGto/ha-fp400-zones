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
    const context = vm.createContext({Buffer, setTimeout, clearTimeout,
        m: builder, exposes: {presets: builder, access: {STATE: 1, SET: 2, ALL: 7}}});
    vm.runInContext(`${code}\nglobalThis.helpers = {parseLayout, parseLocation, cellOf, evaluateZones, clearZones, rt, tzFp400, fzOccupancy};`, context);
    return context.helpers;
}

test('malformed layouts cannot crash the converter', () => {
    const {parseLayout} = load();
    for (const raw of ['null', '1', 'broken', '{"zones":[null,1,{}]}']) {
        assert.equal(parseLayout(raw).zones.length, 0);
    }
});

test('view subscriptions use a bounded expiry and native reports do not overwrite software zones', async () => {
    const {tzFp400, fzOccupancy} = load();
    const commands = [];
    const device = {ieeeAddr: 'example-device', getEndpoint: () => ({command: async (...args) => commands.push(args)})};
    await tzFp400.convertSet(null, 'location_subscribe', 60, {device});
    assert.equal(commands[0][2].timeout, 60);
    for (const value of [0, -1, 3601, 'bad']) await assert.rejects(tzFp400.convertSet(null, 'location_subscribe', value, {device}));
    const msg = {data: {occupancy: 1}, endpoint: {ID: 3}, device};
    assert.equal(fzOccupancy.convert(null, msg, () => {}, {}).zone_1, undefined);
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

test('leaving a zone honors its delay; clearing occupancy cancels pending timers', async () => {
    const {parseLayout, evaluateZones, clearZones, rt} = load();
    const layout = parseLayout({zones: [{id: 1, cells: '80' + '00'.repeat(39), delay: 0.02}]});
    const r = rt({ieeeAddr: 'example-device'});
    assert.equal(evaluateZones(r, layout, [{cell: {bit: 0}}]).zone_1, true);
    const published = new Promise((resolve) => { r.publish = resolve; });
    assert.equal(Object.keys(evaluateZones(r, layout, [])).length, 0);
    assert.equal((await published).zone_1, false);
    evaluateZones(r, layout, [{cell: {bit: 0}}]);
    evaluateZones(r, layout, []);
    assert.equal(clearZones(r).zone_1, false);
    assert.equal(r.timers[1], null);
});
