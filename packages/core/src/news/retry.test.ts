// retry.test.ts — covers backoff + 429 Retry-After + per-attempt timeout
// + non-retryable errors. The retry policy is the foundation of "self-
// healing" — without it, one transient failure surfaces as an empty
// catalysts panel.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, RetryableError, NonRetryableError } from './retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const p = withRetry(fn, { attempts: 3, baseDelayMs: 100, timeoutMs: 1000 });
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on RetryableError up to attempts cap', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('500 transient'))
      .mockRejectedValueOnce(new RetryableError('500 transient'))
      .mockResolvedValueOnce('ok');
    const p = withRetry(fn, { attempts: 3, baseDelayMs: 10, timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws when all attempts exhausted', async () => {
    // Two rejections — one per attempt. Pre-attach a catch handler on the
    // promise we're about to test so Vitest's unhandled-rejection watcher
    // doesn't fire while we drain timers.
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('boom'))
      .mockRejectedValueOnce(new RetryableError('boom'));
    const p = withRetry(fn, { attempts: 2, baseDelayMs: 10, timeoutMs: 1000 });
    const caught = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect((err as Error).message).toBe('boom');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry NonRetryableError (4xx-config errors)', async () => {
    const fn = vi.fn().mockRejectedValue(new NonRetryableError('401 unauthorized'));
    const p = withRetry(fn, { attempts: 3, baseDelayMs: 10, timeoutMs: 1000 });
    await expect(p).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours retryAfterMs hint from RetryableError (capped at 5s)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('429 rate-limited', { retryAfterMs: 2000 }))
      .mockResolvedValueOnce('ok');
    const p = withRetry(fn, { attempts: 2, baseDelayMs: 100, timeoutMs: 10_000 });
    // Advance just under 2s — should not have retried yet
    await vi.advanceTimersByTimeAsync(1900);
    expect(fn).toHaveBeenCalledTimes(1);
    // Advance past the hint
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toBe('ok');
  });

  it('caps retryAfterMs at 5000ms even when hint is larger', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('429', { retryAfterMs: 20_000 }))
      .mockResolvedValueOnce('ok');
    const p = withRetry(fn, { attempts: 2, baseDelayMs: 100, timeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(5100);
    await expect(p).resolves.toBe('ok');
  });

  it('treats per-attempt timeout as retryable', async () => {
    const fn = vi.fn()
      .mockImplementationOnce(() => new Promise(() => { /* never resolves */ }))
      .mockResolvedValueOnce('ok');
    const p = withRetry(fn, { attempts: 2, baseDelayMs: 10, timeoutMs: 100 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
