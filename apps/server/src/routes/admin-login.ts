// POST /api/admin/login — accepts { token } in body; on match, sets the
// signed HTTP-only session cookie so the browser dashboard can call the
// admin API without re-pasting the token on every request.
//
// POST /api/admin/logout — clears the cookie.
//
// Login is rate-limited at the index.ts wiring level (5/min/IP) to
// frustrate brute-force token guessing. Even without that, the token is
// 32 bytes of entropy from `openssl rand -hex 32`, so guessing is not a
// practical attack — the rate limit is belt + suspenders.

import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ADMIN_COOKIE_NAME, issueSessionCookie } from '../middleware/adminAuth.js';

function secretsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isSecureRequest(req: Request): boolean {
  // Behind Azure Container Apps ingress the request comes in over HTTPS
  // but Express sees it as HTTP. Trust the standard forwarded header
  // pattern instead. We don't trust arbitrary client-supplied headers
  // unless the platform set them.
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.toLowerCase().includes('https');
}

function cookieAttributes(req: Request, maxAgeMs: number): string {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}

export function adminLoginHandler(req: Request, res: Response): void {
  const expected = process.env['ADMIN_TOKEN'];
  if (!expected) {
    res.status(503).json({ error: 'admin endpoints disabled — ADMIN_TOKEN not configured' });
    return;
  }
  const body = req.body as { token?: string } | undefined;
  const got = body?.token;
  if (typeof got !== 'string' || got.length === 0 || !secretsEqual(got, expected)) {
    res.status(401).json({ error: 'invalid token' });
    return;
  }

  const { value, maxAgeMs } = issueSessionCookie(expected);
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(value)}; ${cookieAttributes(req, maxAgeMs)}`,
  );
  res.json({ ok: true, expiresInSeconds: Math.floor(maxAgeMs / 1000) });
}

export function adminLogoutHandler(req: Request, res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecureRequest(req) ? '; Secure' : ''}`,
  );
  res.json({ ok: true });
}
