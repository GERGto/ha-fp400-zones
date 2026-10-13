import assert from 'node:assert/strict';
import {test} from 'node:test';
import {redact, rememberSecret, sameOrigin, validRequest} from '../security.mjs';

test('diagnostics redact known credentials, URLs and device identifiers', () => {
    rememberSecret('example-password');
    rememberSecret('example-user');
    const result = redact('example-password example-user mqtt://user:pass@broker.example:1883 0x0000000000000001 192.0.2.1');
    assert.equal(result, '[redacted] [redacted] [endpoint] [device] [address]');
});

test('only own actions with a numeric request ID can be invoked', () => {
    const actions = {install() {}};
    for (const req of [null, [], 'install', 1, {}, {id: 1, op: 'constructor'}, {id: 2, op: 'toString'}, {id: {}, op: 'install'}]) {
        assert.equal(validRequest(req, actions), false);
    }
    assert.equal(validRequest({id: 1, op: 'install'}, actions), true);
});

test('standalone WebSockets require a matching browser origin', () => {
    const req = (origin) => ({headers: {host: 'localhost:8099', origin}});
    assert.equal(sameOrigin(req('http://localhost:8099')), true);
    for (const origin of [undefined, 'null', 'https://attacker.example', 'http://localhost:8100', 'file://localhost:8099']) {
        assert.equal(sameOrigin(req(origin)), false);
    }
});
