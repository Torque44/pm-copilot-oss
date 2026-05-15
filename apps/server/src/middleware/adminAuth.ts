// Shared-secret gate for admin endpoints. Accepts either:
//   - X-Admin-Token header matching ADMIN_TOKEN env var (CLI / curl path)
//   - A valid signed session cookie issued by POST /api/admin/login
//     (browser dashboard path; HTTP-only so XSS can't read it).
//
// Both paths fail-closed when ADMIN_TOKEN is unset, so a misconfigured
// production deploy can't be exploited by anonymous callers.
//
// The token comparison uses crypto.timingSafeEqual to avoid leaking the
// token byte-by-byte through response-time differences. The cookie is
// HMAC-signed with ADMIN_TOKEN itself (no separate signing secret to
// manage) and carries its own expiry timestamp, so the server stays
// stateless — no session store.

import type { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE_NAME = 'pmc_admin_session';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env['ADMIN_TOKEN'];
  if (!expected) {
    res.status(503).json({ error: 'admin endpoints disabled — ADMIN_TOKEN not configured' });
    return;
  }

  // Path A: bearer-token style header — for curl / scripts.
  const got = req.headers['x-admin-token'];
  if (typeof got === 'string' && secretsEqual(got, expected)) {
    next();
    return;
  }

  // Path B: signed session cookie — for the browser dashboard.
  const cookie = readCookie(req, ADMIN_COOKIE_NAME);
  if (cookie && verifySessionCookie(cookie, expected)) {
    next();
    return;
  }

  res.status(401).json({ error: 'unauthorized' });
}

/** Issue a fresh signed session cookie value. Cookie format:
 *    "<expiresAtMs>.<base64url(hmac-sha256(token, expiresAtMs))>"
 *  Self-contained — the server has no session table. */
export function issueSessionCookie(token: string): { value: string; maxAgeMs: number } {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const sig = signPayload(String(expiresAt), token);
  return { value: `${expiresAt}.${sig}`, maxAgeMs: SESSION_MAX_AGE_MS };
}

function verifySessionCookie(cookieValue: string, token: string): boolean {
  const dot = cookieValue.indexOf('.');
  if (dot <= 0 || dot === cookieValue.length - 1) return false;
  const expiresAtRaw = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = signPayload(expiresAtRaw, token);
  return secretsEqual(sig, expected);
}

function signPayload(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** Parse a single cookie value out of `Cookie:` request header. Avoids
 *  pulling in `cookie-parser` for what's a one-cookie surface. */
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers['cookie'];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) {
      const v = part.slice(eq + 1).trim();
      return v.length > 0 ? decodeURIComponent(v) : null;
    }
  }
  return null;
}

/** Length-checked constant-time comparison. timingSafeEqual itself
 *  requires equal-length buffers and throws otherwise; the length check
 *  short-circuits before the throw so the catch path doesn't leak timing
 *  via stack-unwind cost. */
function secretsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
