// persist.test.ts — locks in the snapshot round-trip behavior.
//
// CRITICAL FOR THE AZURE FILES VOLUME. Phase 2 of the cf-azure-rewrite
// mounts an Azure Files share at /var/data/cache and points CACHE_DIR
// at it. The persist layer must continue to:
//   1. Write a JSON snapshot to ${CACHE_DIR}/snapshot.json on flush
//   2. Read it back on the next process boot via loadSnapshot
//   3. Survive a process restart (the whole point of having persistence)
//
// These tests verify all three. Written against the CURRENT behavior so
// the rewrite doesn't quietly break the volume-mount story.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test creates its own temp CACHE_DIR. Critically: persist.ts reads
// the CACHE_DIR env at MODULE LOAD time (line 16: `const CACHE_DIR =
// process.env['CACHE_DIR'] || ...`). So we use vi.resetModules() + dynamic
// import inside each test to force a fresh CACHE_DIR resolution.

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pm-copilot-persist-test-'));
  vi.stubEnv('CACHE_DIR', tempDir);
  // Force re-import so the next dynamic-import sees the fresh env var.
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tempDir, { recursive: true, force: true });
});

describe('persist — write + read round-trip', () => {
  it('flush writes a valid v1 snapshot to CACHE_DIR/snapshot.json', async () => {
    const persist = await import('./persist.js');

    persist.registerProducer(() => ({
      cache: { 'k1': { value: { foo: 'bar' }, expiresAt: 9_999_999_999_999 } },
      grounding: { 'mkt-1': { book: { bids: [] }, updatedAt: 1700000000000 } },
      briefs: { 'mkt-1': { events: [{ t: 'agent:start', agent: 'market' }], savedAt: 1700000000000 } },
    }));

    persist.markDirty();
    await persist.flush();

    const raw = await readFile(join(tempDir, 'snapshot.json'), 'utf8');
    const snap = JSON.parse(raw);

    expect(snap.version).toBe(1);
    expect(typeof snap.savedAt).toBe('number');
    expect(snap.cache.k1.value).toEqual({ foo: 'bar' });
    expect(snap.grounding['mkt-1'].book).toEqual({ bids: [] });
    expect(snap.briefs['mkt-1'].events[0]).toEqual({ t: 'agent:start', agent: 'market' });
  });

  it('loadSnapshot returns the snapshot a previous process wrote', async () => {
    // Simulate "previous process": write a snapshot via the module, then
    // reset modules so the next dynamic-import gets a fresh in-memory state
    // (no `loaded` cache hit).
    {
      const persist = await import('./persist.js');
      persist.registerProducer(() => ({
        cache: { 'survives': { value: 42, expiresAt: 9_999_999_999_999 } },
        grounding: {},
        briefs: {},
      }));
      persist.markDirty();
    await persist.flush();
    }

    vi.resetModules();
    const persistAfter = await import('./persist.js');
    const snap = await persistAfter.loadSnapshot();

    expect(snap).not.toBeNull();
    expect(snap!.cache.survives!.value).toBe(42);
  });

  it('loadSnapshot returns null when no snapshot exists yet (cold boot)', async () => {
    const persist = await import('./persist.js');
    const snap = await persist.loadSnapshot();
    expect(snap).toBeNull();
  });

  it('loadSnapshot returns null on version mismatch', async () => {
    // Write a snapshot file by hand with version=2 to simulate a future
    // format. The current code requires version === 1.
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, 'snapshot.json'),
      JSON.stringify({ version: 2, savedAt: 0, cache: {}, grounding: {}, briefs: {} }),
      'utf8',
    );

    const persist = await import('./persist.js');
    const snap = await persist.loadSnapshot();
    expect(snap).toBeNull();
  });

  it('loadSnapshot returns null on malformed JSON', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, 'snapshot.json'), 'not json {{{', 'utf8');

    const persist = await import('./persist.js');
    const snap = await persist.loadSnapshot();
    expect(snap).toBeNull();
  });

  it('flush merges multiple producers into one snapshot', async () => {
    const persist = await import('./persist.js');

    persist.registerProducer(() => ({
      cache: { 'a': { value: 1, expiresAt: 9_999_999_999_999 } },
      grounding: {},
      briefs: {},
    }));
    persist.registerProducer(() => ({
      cache: { 'b': { value: 2, expiresAt: 9_999_999_999_999 } },
      grounding: { 'mkt-2': { book: { bids: [{ price: 0.5, size: 100 }] }, updatedAt: 0 } },
      briefs: {},
    }));

    persist.markDirty();
    await persist.flush();

    const raw = await readFile(join(tempDir, 'snapshot.json'), 'utf8');
    const snap = JSON.parse(raw);

    expect(snap.cache.a.value).toBe(1);
    expect(snap.cache.b.value).toBe(2);
    expect(snap.grounding['mkt-2'].book).toEqual({ bids: [{ price: 0.5, size: 100 }] });
  });
});
