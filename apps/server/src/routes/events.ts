// GET /api/event-stream?marketId=<id>
//
// Long-lived SSE connection that pushes:
//   - current grounding snapshot (immediate replay from memory)
//   - any future grounding updates for this market
//   - any brief events still streaming if a supervisor is running
//
// Unlike /api/brief this never triggers agent work. It's purely a listener
// so the UI can stay hydrated across reloads without asking for a fresh run.

import type { Request, Response } from 'express';
import { openSse } from '@pm-copilot/core/sse';
import { readGrounding } from '../groundingStore.js';
import { getCached, type BriefEnvelope } from '../briefStore.js';
import { subscribe, replay } from '../eventBus.js';
import type { BookGrounding, HoldersGrounding, NewsGrounding } from '@pm-copilot/core';

type GroundingUpdate =
  | { kind: 'book'; data: BookGrounding | null; updatedAt: number }
  | { kind: 'holders'; data: HoldersGrounding | null; updatedAt: number }
  | { kind: 'news'; data: NewsGrounding | null; updatedAt: number };

export async function eventsHandler(req: Request, res: Response) {
  const marketId = String(req.query.marketId ?? '').trim();
  if (!marketId) {
    res.status(400).json({ error: 'missing marketId' });
    return;
  }
  const sse = openSse(res);

  // 1) initial grounding snapshot (book / holders / news).
  const g = readGrounding(marketId);
  if (g) {
    sse.send({ t: 'hydrate:grounding', marketId, updatedAt: g.updatedAt, book: g.book ?? null, holders: g.holders ?? null, news: g.news ?? null });
  }

  // 2) initial brief snapshot (if cached).
  const b = getCached(marketId);
  if (b) {
    sse.send({ t: 'hydrate:brief', marketId, savedAt: b.savedAt, events: b.events });
  }

  // 3) subscribe to future grounding updates + brief replays.
  const groundingOff = subscribe<GroundingUpdate>(`grounding:${marketId}`, (ev) => {
    sse.send({ t: 'grounding:update', marketId, ...ev });
  });

  // Stream any events the supervisor is pushing in real-time (if a run is active).
  const briefOff = subscribe<BriefEnvelope>(`brief:${marketId}`, (ev) => {
    sse.send({ t: 'brief:event', marketId, event: ev });
  });

  // Keep the connection alive with a periodic ping.
  const ping = setInterval(() => {
    try { sse.send({ t: 'ping', at: Date.now() }); } catch { /* closed */ }
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    groundingOff();
    briefOff();
    sse.close();
  });

  // Also send any events that were published before the subscription was set up
  // (bus has a rolling buffer). This covers the race where the brief started
  // just before the client connected.
  const pastBriefEvents = replay<BriefEnvelope>(`brief:${marketId}`);
  if (pastBriefEvents.length) {
    sse.send({ t: 'replay:brief', marketId, events: pastBriefEvents });
  }
}
