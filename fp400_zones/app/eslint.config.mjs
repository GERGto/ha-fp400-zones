import js from '@eslint/js';
import globals from 'globals';

export default [
    {ignores: ['node_modules/**', '.npm-cache/**', 'data/**']},
    js.configs.recommended,
    {
        files: ['**/*.mjs'],
        languageOptions: {globals: globals.node},
        rules: {'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none'}]},
    },
    {
        files: ['public/browser.js'],
        languageOptions: {globals: globals.browser},
        rules: {'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none'}]},
    },
];
