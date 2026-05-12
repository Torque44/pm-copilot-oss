// Shared-secret gate for admin endpoints. Requires X-Admin-Token header to
// match ADMIN_TOKEN env var. If ADMIN_TOKEN is unset, the gate refuses ALL
// requests (fail-closed) so a misconfigured production deploy can't be
// flushed by anonymous callers.
//
// The string comparison uses crypto.timingSafeEqual so an attacker can't
// learn the token byte-by-byte from response-time differences. The token
// is expected to be a fixed-length opaque secret; a length mismatch
// short-circuits before the constant-time check.

import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env['ADMIN_TOKEN'];
  if (!expected) {
    res.status(503).json({ error: 'admin endpoints disabled — ADMIN_TOKEN not configured' });
    return;
  }
  const got = req.headers['x-admin-token'];
  if (typeof got !== 'string' || !secretsEqual(got, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

/** Length-checked constant-time comparison. timingSafeEqual itself requires
 *  equal-length buffers and throws otherwise; we guard with a length check
 *  so the throw doesn't leak timing info via the catch path. */
function secretsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return timingSafeEqual(aBuf, bBuf);
}
