// pm-copilot server bootstrap.
//
// Wires:
//   - new beta routes: positions, profile, auth-test
//   - ported routes: brief, ask, events, markets-list, event-stream
//   - byok header middleware (BYOK keys flow as per-request headers, never persisted)
//   - persistence rehydrate on boot, snapshot flush on shutdown

import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { byokHeader } from './middleware/byokHeader.js';
import { adminAuth } from './middleware/adminAuth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { positionsHandler } from './routes/positions.js';
import { profileHandler } from './routes/profile.js';
import { authTestHandler } from './routes/auth-test.js';
import { resolveHandler } from './routes/resolve.js';
import { healthProvidersHandler } from './routes/health-providers.js';
import { verifyHandleHandler } from './routes/verify-handle.js';
import { briefHandler } from './routes/brief.js';
import { askHandler } from './routes/ask.js';
import {
  getMarketsHandler,
  getMarketByIdHandler,
  getMarketsListHandler,
  getEventsListHandler,
  getEventByIdHandler,
} from './routes/markets.js';
import { loadSnapshot, installShutdownHooks, flush } from './persist.js';
import { hydrate as hydrateCache, clear as clearCache } from './cache.js';
import { hydrate as hydrateGrounding } from './groundingStore.js';
import { hydrate as hydrateBriefs, invalidateBrief } from './briefStore.js';

// Prefer SERVER_PORT, fall back to PORT, then 8787. Skip PORT if it collides
// with the Vite frontend (5173) — that happens when the dev harness inherits
// PORT=5173 to forward to subprocesses, which the api would otherwise pick up
// and then fail to bind because Vite already owns that port.
const _rawPort = Number(process.env['SERVER_PORT'] || process.env['PORT'] || 8787);
const PORT = _rawPort === 5173 ? 8787 : _rawPort;
// CORS_ORIGIN accepts a comma-separated allowlist or a single origin.
// Wildcard '*' is treated as the same-origin / unconfigured-fallback case
// since the production deploy serves the web bundle from the api host
// (CORS is a no-op there), and any explicit list is preferred for safety.
const CORS_ORIGIN_RAW = process.env['CORS_ORIGIN'] || 'http://localhost:5173';
const CORS_ALLOWLIST = CORS_ORIGIN_RAW
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const NODE_ENV = process.env['NODE_ENV'] || 'development';
const IS_PROD = NODE_ENV === 'production';

// In production we serve the web bundle from the same origin so the browser
// hits /api on its own host and CORS is a no-op. The server resolves the
// web/dist path relative to its own dist/ directory:
//   apps/server/dist/index.js  →  ../../web/dist
// `existsSync` guards the case where someone runs `node dist/index.js`
// without having built the web app first (e.g. an api-only deploy).
const WEB_DIST = (() => {
  if (!IS_PROD) return null;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, '../../web/dist');
  return existsSync(candidate) ? candidate : null;
})();

async function main() {
  const app = express();

  // Trust one upstream proxy (Azure Container Apps ingress) so req.ip
  // reflects the real client IP instead of the proxy's. Required for
  // per-IP rate limiting on auth-test / brief / ask to be accurate.
  app.set('trust proxy', 1);

  // CORS: in dev the web app runs on a different port (5173) and needs
  // explicit origin allowance. In production the web app is served from
  // the same origin as the api, so CORS is a no-op for first-party traffic.
  // CORS_ORIGIN may be a comma-separated allowlist for split-host or
  // multi-environment deploys; '*' is rejected to prevent a misconfigured
  // env from widening API exposure to any third-party origin.
  app.use(cors({
    origin: (origin, cb) => {
      // No Origin header (same-origin / curl / health checks) → allow.
      if (!origin) return cb(null, true);
      // Explicit wildcard rejected — would let any page on the internet
      // call cost-bearing API routes when env or claude-code session auth
      // is active server-side. Use an allowlist instead.
      if (CORS_ALLOWLIST.includes('*')) return cb(null, false);
      if (CORS_ALLOWLIST.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: false,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(byokHeader);

  // ---- Health ----
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'pm-copilot',
      version: '0.1.0-beta.0',
      uptime: process.uptime(),
      pid: process.pid,
    });
  });

  // ---- BYOK auth check ----
  // 10 per minute per IP: enough headroom to validate 4 provider keys
  // without forcing a coffee break, tight enough to deny key probing.
  app.post('/api/auth/test', rateLimit({ windowMs: 60_000, max: 10, bucket: 'auth-test' }), authTestHandler);
  // Health-providers triggers a real LLM probe under the hood (it costs
  // an LLM call per uncached provider). 20/min is well above the right-rail's
  // refresh cadence and well below what a script could use to mass-probe
  // BYOK keys.
  app.get('/api/health/providers', rateLimit({ windowMs: 60_000, max: 20, bucket: 'health-providers' }), healthProvidersHandler);

  // ---- New beta routes ----
  // Public lookup routes proxy Polymarket / X.com on every uncached request.
  // Rate limits are generous (60-120/hr/IP) so honest users never hit them,
  // tight enough to deny a script flooding unique handles or wallets to
  // grow our in-memory caches or tie up upstream calls.
  app.get('/api/positions', rateLimit({ windowMs: 60 * 60 * 1000, max: 120, bucket: 'positions' }), positionsHandler);
  app.get('/api/profile/:handle', rateLimit({ windowMs: 60 * 60 * 1000, max: 120, bucket: 'profile' }), profileHandler);
  app.get('/api/resolve', rateLimit({ windowMs: 60 * 60 * 1000, max: 60, bucket: 'resolve' }), resolveHandler);
  // verify-handle fires on every keystroke (debounced 400ms) so its limit
  // needs more headroom — 300 hits an honest typist's session ceiling.
  app.get('/api/verify-handle', rateLimit({ windowMs: 60 * 60 * 1000, max: 300, bucket: 'verify-handle' }), verifyHandleHandler);

  // ---- Ported routes ----
  app.get('/api/markets', getMarketsHandler);
  app.get('/api/markets-list', getMarketsListHandler);
  app.get('/api/market', getMarketByIdHandler);
  // 30 briefs per hour per IP — well above honest single-user load and
  // far below what an OpenAI-bill-draining bot would attempt.
  app.get('/api/brief', rateLimit({ windowMs: 60 * 60 * 1000, max: 30, bucket: 'brief' }), briefHandler);
  // 30 questions per hour per IP — same shape ask had inline, now via the
  // shared util so brief/auth-test reuse the same machinery.
  app.post('/api/ask', rateLimit({ windowMs: 60 * 60 * 1000, max: 30, bucket: 'ask' }), askHandler);
  app.get('/api/events', getEventsListHandler);
  app.get('/api/event', getEventByIdHandler);

  // /api/event-stream (long-lived SSE relay) was removed in the
  // cf-azure-rewrite. The deploy story doesn't include long-lived
  // streams and no client surface consumed it.

  // ---- Admin: force flush + clear caches ----
  // Gated by X-Admin-Token header; ADMIN_TOKEN env must be set in prod.
  app.post('/api/admin/flush', adminAuth, async (req, res) => {
    clearCache();
    const marketId = typeof req.query['marketId'] === 'string' ? req.query['marketId'] : null;
    if (marketId) invalidateBrief(marketId);
    await flush();
    res.json({ ok: true });
  });

  // ---- Static web bundle (production only) ----
  // When a `web/dist` build is present, serve it from the same origin so
  // /api/* and / share a host. Cache-busting is handled by Vite's content-
  // hashed filenames; index.html itself is never cached so deploys roll
  // out cleanly. The SPA fallback below catches any non-API path and
  // returns index.html so React Router routes (/m/:id, /setup, etc.) work
  // on direct page loads + hard refreshes.
  if (WEB_DIST) {
    app.use(
      express.static(WEB_DIST, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else {
            // Hashed assets (Vite produces /assets/<name>-<hash>.<ext>)
            // are safe to cache aggressively.
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
    console.info(`[pm-copilot] serving web bundle from ${WEB_DIST}`);
  }

  // ---- 404 ----
  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // ---- Boot persistence ----
  const snap = await loadSnapshot();
  if (snap) {
    hydrateCache(snap.cache);
    hydrateGrounding(snap.grounding as Parameters<typeof hydrateGrounding>[0]);
    hydrateBriefs(snap.briefs);
    const ageS = ((Date.now() - snap.savedAt) / 1000).toFixed(0);
    console.info(`[pm-copilot] rehydrated snapshot (age ${ageS}s, ${Object.keys(snap.cache).length} cache keys, ${Object.keys(snap.grounding).length} grounded markets, ${Object.keys(snap.briefs).length} cached briefs)`);
  } else {
    console.info('[pm-copilot] no snapshot found — starting cold');
  }
  installShutdownHooks();

  app.listen(PORT, () => {
    console.info(`[pm-copilot] server listening on http://localhost:${PORT}`);
    console.info(`[pm-copilot] cors origin: ${CORS_ALLOWLIST.join(', ') || '(none — same-origin only)'}`);
  });
}

main().catch((err) => {
  console.error('[pm-copilot] fatal:', err);
  process.exit(1);
});
