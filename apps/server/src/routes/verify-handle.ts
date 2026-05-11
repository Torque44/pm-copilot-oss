// GET /api/verify-handle?h=<handle>
//
// Best-effort existence check for an X (Twitter) handle. The frontend
// LandingFlow debounces user input by 400ms and hits this route to surface a
// live ✓ / ✕ / ⋯ indicator next to the handle field. It's NOT authoritative —
// Twitter aggressively rate-limits public profile GETs, so an `unknown`
// response is treated as "couldn't verify, let the user proceed" rather than
// a block. The submit form accepts any format-valid handle regardless.
//
// Strategy:
//   1. Format gate (regex). Reject obvious garbage with no network call.
//   2. Memoise positive lookups for 1h — a handle that exists doesn't
//      stop existing within a typing session.
//   3. Single GET to https://x.com/<handle> with a 4s timeout. 200 →
//      exists. 404 → notfound. Anything else (429 / 503 / network error /
//      timeout) → unknown, frontend keeps the input usable.

import type { Request, Response } from 'express';
import { BoundedCache } from '../lib/boundedCache.js';

type CacheEntry = { at: number; result: 'ok' | 'notfound' };
const CACHE_MAX = 2000;
const positiveCache = new BoundedCache<CacheEntry>(CACHE_MAX);
const CACHE_TTL_MS = 60 * 60 * 1000;        // 1h
const PROBE_TIMEOUT_MS = 4_000;
const VALID_HANDLE_RX = /^[A-Za-z0-9_]{1,15}$/;

export async function verifyHandleHandler(req: Request, res: Response) {
  const raw = String(req.query['h'] ?? '').trim().replace(/^@/, '');
  if (!raw || !VALID_HANDLE_RX.test(raw)) {
    res.json({ ok: false, reason: 'invalid_format' });
    return;
  }

  const key = raw.toLowerCase();
  const cached = positiveCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    res.json({ ok: cached.result === 'ok' ? true : false, reason: cached.result === 'ok' ? undefined : 'not_found', cached: true });
    return;
  }

  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    // GET because Twitter returns weird codes for HEAD against profile pages.
    // Browser-like UA bypasses some lightweight anti-bot heuristics.
    const r = await fetch(`https://x.com/${encodeURIComponent(raw)}`, {
      method: 'GET',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(killer);
    if (r.status === 404) {
      positiveCache.set(key, { at: Date.now(), result: 'notfound' });
      res.json({ ok: false, reason: 'not_found' });
      return;
    }
    if (r.status >= 200 && r.status < 300) {
      // x.com returns 200 + a "doesn't exist" error page for some missing
      // handles. The body is large and HTML-heavy; sniffing for the error
      // string is a heuristic, not a guarantee. We accept 200 as `ok`
      // unconditionally — false positives here just mean we don't catch
      // every typo, which is the right error direction.
      positiveCache.set(key, { at: Date.now(), result: 'ok' });
      res.json({ ok: true });
      return;
    }
    // 429 / 503 / anything else → unknown. Don't cache; let the next typing
    // pause re-probe in case it was a transient rate-limit hit.
    res.json({ ok: 'unknown', reason: `upstream_status_${r.status}` });
  } catch (err) {
    clearTimeout(killer);
    const msg = err instanceof Error ? err.message : 'unknown';
    res.json({ ok: 'unknown', reason: msg.includes('abort') ? 'timeout' : 'network_error' });
  }
}
