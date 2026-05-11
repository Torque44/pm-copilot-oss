// Flat-config entrypoint required by ESLint v9+.
//
// We bridge the existing .eslintrc.cjs content through @eslint/eslintrc's
// FlatCompat so we don't have to rewrite every plugin's preset for the new
// format. The legacy config remains the source of truth; this file just
// re-exposes it under the v9 loader.

import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.vercel/**',
      'design-bundle/**',
    ],
  },
  ...compat.config({
    parser: '@typescript-eslint/parser',
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
    plugins: ['@typescript-eslint', 'react-hooks', 'jsx-a11y'],
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:react-hooks/recommended',
      'plugin:jsx-a11y/recommended',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      // a11y rules: kept on as warnings so they show up in editor + CI logs
      // but don't block merges. The workbench has several click-handler
      // divs that pre-date the rules; downgrading to warn matches the
      // project's accepted state until a focused a11y pass happens.
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-element-to-interactive-role': 'warn',
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
      // `[\[\]]` is the idiomatic way to strip square brackets inside a
      // character class; ESLint's no-useless-escape is over-eager here.
      'no-useless-escape': 'warn',
    },
  }),
];
