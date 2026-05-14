// Sanity tests for the L3 analytics layer. Uses an isolated temp dir as
// CACHE_DIR so test runs don't touch any real /var/data state.

import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let tmpRoot: string;
let recordIdentity: typeof import('./analytics.js').recordIdentity;
let recordEvent: typeof import('./analytics.js').recordEvent;
let getStats: typeof import('./analytics.js').getStats;
let dumpAll: typeof import('./analytics.js').dumpAll;

beforeAll(async () => {
  // Create the tmp dir BEFORE importing analytics.ts so the module-level
  // CACHE_DIR / ROOT consts resolve against it.
  tmpRoot = await mkdtemp(join(tmpdir(), 'pm-analytics-'));
  process.env['CACHE_DIR'] = join(tmpRoot, 'cache');
  const mod = await import('./analytics.js');
  recordIdentity = mod.recordIdentity;
  recordEvent = mod.recordEvent;
  getStats = mod.getStats;
  dumpAll = mod.dumpAll;
});

afterAll(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  // Reset NDJSON + users.json between tests. We don't reset the in-memory
  // `users` cache here — the module-private state is reused across tests
  // in the same file. Use distinct wallets per test to avoid cross-talk.
});

describe('analytics — identity', () => {
  it('upserts a wallet and increments visit_count on repeat', async () => {
    await recordIdentity('0xAAAA000000000000000000000000000000000001', 'alice');
    await recordIdentity('0xAAAA000000000000000000000000000000000001', 'alice_new');

    const { users } = await dumpAll();
    const alice = users.find((u) => u.wallet === '0xaaaa000000000000000000000000000000000001');
    expect(alice).toBeDefined();
    expect(alice!.visitCount).toBe(2);
    // Handle update on re-visit
    expect(alice!.handle).toBe('alice_new');
  });

  it('ignores empty / null wallet', async () => {
    await recordIdentity('', 'someone');
    await recordIdentity(null, 'someone-else');
    await recordIdentity(undefined, undefined);
    const { users } = await dumpAll();
    const empties = users.filter((u) => !u.wallet);
    expect(empties).toHaveLength(0);
  });

  it('strips leading @ from handle', async () => {
    await recordIdentity('0xBBBB000000000000000000000000000000000002', '@bob');
    const { users } = await dumpAll();
    const bob = users.find((u) => u.wallet === '0xbbbb000000000000000000000000000000000002');
    expect(bob?.handle).toBe('bob');
  });
});

describe('analytics — events', () => {
  it('appends one NDJSON line per event', async () => {
    const before = (await dumpAll()).events.length;
    await recordEvent({ wallet: '0xCCCC000000000000000000000000000000000003', handle: 'carol', type: 'brief', marketId: 'mkt-1', category: 'politics' });
    await recordEvent({ wallet: '0xCCCC000000000000000000000000000000000003', handle: 'carol', type: 'ask', marketId: 'mkt-1', meta: { questionLength: 42 } });
    const after = (await dumpAll()).events;
    expect(after.length).toBe(before + 2);
    const ask = after[after.length - 1]!;
    expect(ask.type).toBe('ask');
    expect(ask.meta?.['questionLength']).toBe(42);
  });

  it('stats aggregate correctly', async () => {
    await recordEvent({ wallet: '0xDDDD000000000000000000000000000000000004', handle: 'dan', type: 'brief', marketId: 'mkt-2', category: 'crypto' });
    await recordEvent({ wallet: '0xDDDD000000000000000000000000000000000004', handle: 'dan', type: 'brief', marketId: 'mkt-2', category: 'crypto' });
    const stats = await getStats();
    expect(stats.totals.briefs).toBeGreaterThanOrEqual(2);
    const mkt2 = stats.topMarkets.find((m) => m.marketId === 'mkt-2');
    expect(mkt2?.count).toBeGreaterThanOrEqual(2);
  });

  it('NDJSON on disk is line-delimited and parseable line-by-line', async () => {
    await recordEvent({ wallet: '0xEEEE000000000000000000000000000000000005', handle: null, type: 'visit' });
    const ndjson = await readFile(join(tmpRoot, 'analytics', 'events.ndjson'), 'utf8');
    const lines = ndjson.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
