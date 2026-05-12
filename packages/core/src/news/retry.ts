// retry.ts — bounded-attempt retry with exponential backoff + 429 Retry-After
// respect + per-attempt timeout. Used by every backend in the news chain.
//
// The retry policy is the difference between "self-healing on transient
// failures" and "silent empty catalysts on the first network hiccup." We
// distinguish RetryableError (5xx, 429, timeout, network) from
// NonRetryableError (4xx-config: 401, 403, 404) so config bugs don't waste
// retry budget.

export class RetryableError extends Error {
  retryAfterMs?: number;
  constructor(message: string, opts?: { retryAfterMs?: number }) {
    super(message);
    this.name = 'RetryableError';
    if (opts?.retryAfterMs != null) this.retryAfterMs = opts.retryAfterMs;
  }
}

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export type RetryOpts = {
  /** Max number of attempts including the first. */
  attempts: number;
  /** Base delay for exponential backoff: delay = base * 2^(attempt-1). */
  baseDelayMs: number;
  /** Per-attempt wall-clock timeout. */
  timeoutMs: number;
};

const RETRY_AFTER_CAP_MS = 5_000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await raceWithTimeout(fn, opts.timeoutMs);
    } catch (err) {
      lastErr = err;
      if (err instanceof NonRetryableError) throw err;
      if (attempt >= opts.attempts) break;

      const retryAfter = err instanceof RetryableError && err.retryAfterMs != null
        ? Math.min(err.retryAfterMs, RETRY_AFTER_CAP_MS)
        : opts.baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(retryAfter);
    }
  }
  throw lastErr;
}

async function raceWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new RetryableError(`attempt timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
