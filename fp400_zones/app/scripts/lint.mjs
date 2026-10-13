import fs from 'node:fs/promises';
import {ESLint} from 'eslint';

const eslint = new ESLint();
const results = await eslint.lintFiles(['*.mjs', 'converter/*.mjs', 'scripts/*.mjs', 'test/*.mjs']);
const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error('Expected one inline editor script');
results.push(...await eslint.lintText(scripts[0][1], {filePath: 'public/browser.js'}));
const formatter = await eslint.loadFormatter('stylish');
console.log(formatter.format(results));
if (results.some((result) => result.errorCount || result.warningCount)) process.exitCode = 1;
