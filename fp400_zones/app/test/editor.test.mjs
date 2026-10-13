import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

test('editor escapes untrusted MQTT readings and zone names before rendering', () => {
    const source = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const escape = source.match(/^ {2}const esc = .+$/m)[0];
    const render = source.slice(source.indexOf('  function renderState()'), source.indexOf('  const needDevice'));
    const nodes = {stateTable: {}, liveLine: {}};
    const markup = '<img src=x onerror=alert(1)>';
    vm.runInNewContext(`${escape}\n${render}\nrenderState();`, {
        $: (id) => nodes[id],
        live: {zones: {1: true}, targets: [], count: markup, presence: true},
        model: {zones: [{name: markup}]},
        lastState: {illuminance: markup},
    });
    assert.equal(nodes.stateTable.innerHTML.includes('<img'), false);
    assert.equal(nodes.stateTable.innerHTML.match(/&lt;img/g).length, 3);
});
