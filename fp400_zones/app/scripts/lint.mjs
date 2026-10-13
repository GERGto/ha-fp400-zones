import {ESLint} from 'eslint';

const eslint = new ESLint();
const results = await eslint.lintFiles(['*.mjs', 'converter/*.mjs', 'scripts/*.mjs', 'test/*.mjs', 'public/*.js']);
const formatter = await eslint.loadFormatter('stylish');
console.log(formatter.format(results));
if (results.some((result) => result.errorCount || result.warningCount)) process.exitCode = 1;
