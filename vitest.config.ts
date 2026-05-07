// vitest.config.ts — workspace-level test orchestration.
//
// Each workspace package (apps/web, apps/server, packages/core) runs its
// own test suite via per-package configs (or, for the simpler cases, just
// inline `*.test.ts` files picked up by this root config). The split:
//
//   - packages/core    — pure logic, plain Node env, no DOM
//   - apps/server      — Node env, no DOM
//   - apps/web         — DOM env via jsdom for React components + hooks
//
// We don't use vitest's projects feature because our files are spread
// thinly enough that pattern-matching is simpler. The `environmentMatchGlobs`
// switches the env per-file based on path.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'packages/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.cache/**'],
    // Per-file environment selection: web tests need jsdom, everything
    // else runs in node. Keeps server + core test runs lean.
    environmentMatchGlobs: [
      ['apps/web/**/*.test.{ts,tsx}', 'jsdom'],
      ['**/*.test.{ts,tsx}', 'node'],
    ],
    // Coverage is opt-in via `pnpm test -- --coverage`. We don't gate
    // commits on coverage thresholds; the test suite exists to lock in
    // behavior pre-rewrite, not to chase a number.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.{ts,tsx}',
        'apps/web/vite.config.ts',
        'vitest.config.ts',
      ],
    },
    // Reasonable defaults — most tests are fast unit tests; the Node
    // subprocess test for anthropic-cc takes a few seconds when the
    // claude CLI is installed.
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
