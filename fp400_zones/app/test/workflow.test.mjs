import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Workflow, validateRoom} from '../workflow.mjs';

function fixture() {
    let time = 100000;
    const sent = [], profiles = {};
    const w = new Workflow({profiles, save() {}, changed() {}, log() {}, send: (id, value) => sent.push({id, value}), now: () => time});
    return {w, sent, profiles, advance: (ms) => { time += ms; }, tick: (layouts = () => null) => w.tick(['a', 'b'], layouts)};
}
test('view leases are per sensor and closing one browser does not stop another', () => {
    const f = fixture(); f.w.watch('tab1', 'a'); f.w.watch('tab2', 'a'); f.tick();
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].value.location_subscribe, 60);
    f.w.watch('tab1', null); f.advance(30000); f.tick(); assert.equal(f.sent.length, 2);
    f.w.watch('tab2', null); f.tick(); assert.equal(f.w.streams.size, 0);
    f.advance(60000); f.tick(); assert.equal(f.sent.length, 2);
});
test('saved zones never renew a position stream without viewers', () => {
    const f = fixture(); f.w.watch('tab', 'a'); f.tick(); f.advance(46000); f.tick(); assert.equal(f.w.streams.size, 0);
    const layout = () => ({zones: [{enabled: true, cells: '80' + '00'.repeat(39)}]});
    f.w.update('b', {zoneMode: 'native'}); f.tick(layout); assert.equal(f.w.streams.has('a'), false); assert.equal(f.w.streams.has('b'), false);
});
test('room learning waits ten seconds, ignores cached success and requires fresh confirmation', () => {
    const f = fixture(); f.w.startLearning('a'); f.advance(9999); f.tick(); assert.equal(f.sent.length, 0);
    f.advance(1); f.tick(); assert.deepEqual(f.sent[0], {id: 'a', value: {background_learning: 'start'}});
    f.w.observe('a', {background_learning_result: 'success'}); assert.equal(f.w.jobs.get('a').status, 'learning');
    f.w.observe('b', {background_learning_result: 'running'}); assert.equal(f.w.jobs.get('a').sawRunning, false);
    f.w.observe('a', {background_learning_result: 'running'}); f.w.observe('a', {background_learning_result: 'success'});
    assert.equal(f.w.jobs.get('a').status, 'complete'); assert.ok(f.profiles.a.learnedAt); assert.equal(f.profiles.b, undefined);
});
test('learning timeouts fail instead of reporting false success; countdown can be cancelled', () => {
    const f = fixture(); f.w.startLearning('a'); f.w.cancelLearning('a'); f.advance(10000); f.tick(); assert.equal(f.sent.length, 0);
    f.w.startLearning('a'); f.advance(10000); f.tick(); f.advance(120001); f.tick(); assert.equal(f.w.jobs.get('a').status, 'error'); assert.equal(f.profiles.a, undefined);
});
test('room metadata rejects invalid or oversized traces', () => {
    assert.throws(() => validateRoom({outline: []}));
    assert.throws(() => validateRoom({outline: [{x: 0, y: 0}, {x: 900, y: 0}, {x: 0, y: 100}]}));
    assert.equal(validateRoom({outline: [{x: 0, y: 0}, {x: 100, y: 0}, {x: 0, y: 100}]}).passes, 2);
});
