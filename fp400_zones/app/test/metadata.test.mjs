import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {parse} from 'yaml';

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('app metadata, lockfile and translated options agree', () => {
    const config = parse(read('../../config.yaml'));
    const pkg = JSON.parse(read('../package.json'));
    const lock = JSON.parse(read('../package-lock.json'));
    const repo = parse(read('../../../repository.yaml'));
    for (const key of ['name', 'version', 'slug', 'description', 'arch', 'options', 'schema']) assert.ok(config[key]);
    assert.equal(config.version, pkg.version);
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(repo.url, config.url);
    assert.match(read('../../CHANGELOG.md'), new RegExp(`## ${pkg.version.replaceAll('.', '\\.')}`));
    for (const lang of ['en', 'de']) {
        const translated = parse(read(`../../translations/${lang}.yaml`));
        assert.deepEqual(Object.keys(translated.configuration).sort(), Object.keys(config.schema).sort());
    }
    const workflow = parse(read('../../../.github/workflows/checks.yaml'));
    assert.ok(workflow.jobs['addon-lint']);
    assert.equal(workflow.permissions.contents, 'read');
});
