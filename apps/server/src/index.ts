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
import { positionsHandler } from './routes/positions.js';
import { profileHandler } from './routes/profile.js';
import { authTestHandler } from './routes/auth-test.js';
import { resolveHandler } from './routes/resolve.js';
import { healthProvidersHandler } from './routes/health-providers.js';
import { briefHandler } from './routes/brief.js';
import { askHandler } from './routes/ask.js';
import {
  getMarketsHandler,
  getMarketByIdHandler,
  getMarketsListHandler,
  getEventsListHandler,
  getEventByIdHandler,
} from './routes/markets.js';
import { eventsHandler } from './routes/events.js';
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
const CORS_ORIGIN = process.env['CORS_ORIGIN'] || 'http://localhost:5173';
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

  // CORS: in dev the web app runs on a different port (5173) and needs
  // explicit origin allowance. In production the web app is served from
  // the same origin as the api, so we still allow the same-host request.
  // CORS_ORIGIN can be set to a public URL for split-host deployments.
  app.use(cors({ origin: CORS_ORIGIN, credentials: false }));
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
  app.post('/api/auth/test', authTestHandler);
  app.get('/api/health/providers', healthProvidersHandler);

  // ---- New beta routes ----
  app.get('/api/positions', positionsHandler);
  app.get('/api/profile/:handle', profileHandler);
  app.get('/api/resolve', resolveHandler);

  // ---- Ported routes ----
  app.get('/api/markets', getMarketsHandler);
  app.get('/api/markets-list', getMarketsListHandler);
  app.get('/api/market', getMarketByIdHandler);
  app.get('/api/brief', briefHandler);
  app.post('/api/ask', askHandler);
  app.get('/api/events', getEventsListHandler);
  app.get('/api/event', getEventByIdHandler);
  app.get('/api/event-stream', eventsHandler);

  // ---- Admin: force flush + clear caches ----
  app.post('/api/admin/flush', async (req, res) => {
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
    console.info(`[pm-copilot] cors origin: ${CORS_ORIGIN}`);
  });
}

main().catch((err) => {
  console.error('[pm-copilot] fatal:', err);
  process.exit(1);
});
