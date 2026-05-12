// briefStore.test.ts — lock in the eventBus channel reclamation on
// invalidate so the channels Map doesn't grow unbounded across unique
// marketIds (one channel per ever-briefed market, never reaped).

import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('CACHE_DIR', '/tmp/pm-copilot-cache-test-noop-brief');
});

describe('briefStore.invalidateBrief', () => {
  it('clears the brief:<marketId> eventBus topic', async () => {
    const { invalidateBrief, startRecording } = await import('./briefStore.js');
    const { publish, topicsForPrefix } = await import('./eventBus.js');

    // Pre-seed the topic by publishing a synthetic event.
    publish('brief:m-1', { t: 'agent:start', agent: 'market' });
    expect(topicsForPrefix('brief:').includes('brief:m-1')).toBe(true);

    invalidateBrief('m-1');
    expect(topicsForPrefix('brief:').includes('brief:m-1')).toBe(false);

    // startRecording is also a producer of new topic entries — confirm it
    // re-creates the channel cleanly on the next run (no stale references).
    const rec = startRecording('m-1');
    rec({ t: 'agent:start', agent: 'market' });
    expect(topicsForPrefix('brief:').includes('brief:m-1')).toBe(true);
  });
});
