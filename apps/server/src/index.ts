// pm-copilot server bootstrap.
//
// Wires:
//   - new beta routes: positions, profile, auth-test
//   - ported routes: brief, ask, events, markets-list, event-stream
//   - byok header middleware (BYOK keys flow as per-request headers, never persisted)
//   - persistence rehydrate on boot, snapshot flush on shutdown

import express, { type Request, type Response } from 'express';
import cors from 'cors';
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

const PORT = Number(process.env['PORT'] || 8787);
const CORS_ORIGIN = process.env['CORS_ORIGIN'] || 'http://localhost:5173';

async function main() {
  const app = express();

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
