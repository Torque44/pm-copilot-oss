// Shared-secret gate for admin endpoints. Requires X-Admin-Token header to
// match ADMIN_TOKEN env var. If ADMIN_TOKEN is unset, the gate refuses ALL
// requests (fail-closed) so a misconfigured production deploy can't be
// flushed by anonymous callers.

import type { Request, Response, NextFunction } from 'express';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env['ADMIN_TOKEN'];
  if (!expected) {
    res.status(503).json({ error: 'admin endpoints disabled — ADMIN_TOKEN not configured' });
    return;
  }
  const got = req.headers['x-admin-token'];
  if (typeof got !== 'string' || got !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
