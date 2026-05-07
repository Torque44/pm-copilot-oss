// cache.test.ts — locks in TTL hit/miss + singleflight semantics.
//
// The cache layer doesn't change in the cf-azure rewrite (filesystem
// persistence stays via Azure Files mount), but its API surface IS
// consumed by every agent fan-out and route handler. If a refactor
// during the rewrite quietly breaks the singleflight property — for
// example by serializing cached values across module instances —
// duplicate Polymarket fetches start hammering and we burn LLM budget
// for free. These tests baseline the current behavior.

import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  // Reset modules so each test gets a clean cache + fresh CACHE_DIR.
  // persist.ts holds module-level state (the producers list) and the
  // cache.ts auto-registers itself when imported.
  vi.resetModules();
  // Stash CACHE_DIR somewhere that won't collide; persist.ts won't
  // actually write because we never call markDirty enough to flush
  // before the test process exits.
  vi.stubEnv('CACHE_DIR', '/tmp/pm-copilot-cache-test-noop');
});

describe('cached() — TTL hit/miss', () => {
  it('returns the loader result on cache miss', async () => {
    const { cached } = await import('./cache.js');
    let calls = 0;
    const value = await cached('k1', 60_000, async () => {
      calls += 1;
      return { hello: 'world' };
    });
    expect(value).toEqual({ hello: 'world' });
    expect(calls).toBe(1);
  });

  it('returns the cached value within TTL without calling loader', async () => {
    const { cached } = await import('./cache.js');
    let calls = 0;
    await cached('k2', 60_000, async () => { calls += 1; return 'first'; });
    const second = await cached('k2', 60_000, async () => { calls += 1; return 'second'; });
    expect(second).toBe('first');     // cached value, not "second"
    expect(calls).toBe(1);             // loader only ran once
  });

  it('re-runs loader after TTL expires', async () => {
    const { cached } = await import('./cache.js');
    let calls = 0;
    await cached('k3', 1, async () => { calls += 1; return calls; });
    // Wait past the 1ms TTL
    await new Promise((r) => setTimeout(r, 10));
    const second = await cached('k3', 1, async () => { calls += 1; return calls; });
    expect(second).toBe(2);            // fresh value from second loader call
    expect(calls).toBe(2);
  });
});

describe('cached() — singleflight', () => {
  it('coalesces concurrent loaders for the same key into one execution', async () => {
    const { cached } = await import('./cache.js');
    let calls = 0;
    let resolveLoader: (v: number) => void;
    const slowLoader = () => new Promise<number>((res) => { resolveLoader = res; });

    // Fire three concurrent requests for the same key BEFORE the loader
    // resolves. Singleflight should ensure only one loader call.
    const a = cached('hot', 60_000, async () => {
      calls += 1;
      return slowLoader();
    });
    const b = cached('hot', 60_000, async () => {
      calls += 1;
      return slowLoader();
    });
    const c = cached('hot', 60_000, async () => {
      calls += 1;
      return slowLoader();
    });

    // Let microtasks flush so all three have entered the cached() body.
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);             // Only the first loader registered

    resolveLoader!(42);
    const [va, vb, vc] = await Promise.all([a, b, c]);

    expect(va).toBe(42);
    expect(vb).toBe(42);
    expect(vc).toBe(42);
    expect(calls).toBe(1);             // Still only one loader call total
  });

  it('different keys do NOT coalesce', async () => {
    const { cached } = await import('./cache.js');
    let calls = 0;
    const a = cached('alpha', 60_000, async () => { calls += 1; return 'a'; });
    const b = cached('beta', 60_000, async () => { calls += 1; return 'b'; });
    await Promise.all([a, b]);
    expect(calls).toBe(2);
  });
});

describe('invalidate() + clear()', () => {
  it('invalidate(key) drops a single entry', async () => {
    const { cached, invalidate } = await import('./cache.js');
    let calls = 0;
    await cached('drop-me', 60_000, async () => { calls += 1; return 'first'; });
    invalidate('drop-me');
    const after = await cached('drop-me', 60_000, async () => { calls += 1; return 'second'; });
    expect(after).toBe('second');
    expect(calls).toBe(2);
  });

  it('clear() drops every entry', async () => {
    const { cached, clear } = await import('./cache.js');
    let calls = 0;
    await cached('a', 60_000, async () => { calls += 1; return 1; });
    await cached('b', 60_000, async () => { calls += 1; return 2; });
    clear();
    await cached('a', 60_000, async () => { calls += 1; return 11; });
    await cached('b', 60_000, async () => { calls += 1; return 22; });
    expect(calls).toBe(4);             // all four loaders ran
  });
});
