// Per-IP sliding-window rate limit. In-memory, bounded via sweepExpired.
// Used by /api/ask, /api/auth/test, /api/brief.
//
// Limits sized so honest users never hit them: brief at 30/hour, ask at
// 30/hour, auth-test at 10/min (just enough to validate 3-4 keys without
// burst-friction). Behind Azure Container Apps ingress with app.set('trust
// proxy', 1), req.ip is the real client.

import type { Request, Response, NextFunction } from 'express';

export type RateLimitOpts = {
  /** Time window in ms. */
  windowMs: number;
  /** Max requests per IP per window. */
  max: number;
  /** Optional bucket name for logs (so different routes don't share buckets). */
  bucket?: string;
};

type Limiter = (req: Request, res: Response, next: NextFunction) => void;

export function rateLimit(opts: RateLimitOpts): Limiter {
  const buckets = new Map<string, number[]>();
  let sweepCounter = 0;
  const SWEEP_EVERY = 200;

  const sweepExpired = (cutoff: number): void => {
    for (const [k, v] of buckets) {
      if (!v.some((t) => t > cutoff)) buckets.delete(k);
    }
  };

  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const cutoff = now - opts.windowMs;
    const stamps = buckets.get(ip)?.filter((t) => t > cutoff) ?? [];
    if (stamps.length >= opts.max) {
      const oldest = stamps[0]!;
      const retryAfterMs = Math.max(0, opts.windowMs - (now - oldest));
      const retryS = Math.ceil(retryAfterMs / 1000);
      res.setHeader('Retry-After', String(retryS));
      res.setHeader('X-RateLimit-Limit', String(opts.max));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({
        error: `rate limit exceeded — ${opts.max} per ${Math.round(opts.windowMs / 60000)} min. Retry in ${Math.ceil(retryS / 60)} min.`,
      });
      return;
    }
    stamps.push(now);
    buckets.set(ip, stamps);
    if (++sweepCounter % SWEEP_EVERY === 0) sweepExpired(cutoff);
    res.setHeader('X-RateLimit-Limit', String(opts.max));
    res.setHeader('X-RateLimit-Remaining', String(opts.max - stamps.length));
    next();
  };
}
