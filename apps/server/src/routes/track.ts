// POST /api/track — client-fired usage event (visit, market_view, onboarding_complete).
//
// Brief / ask events are recorded server-side directly from those routes,
// so the client doesn't need to fire them. This endpoint covers the
// frontend-only events that the server doesn't otherwise see.
//
// Body shape:
//   { type: 'visit' | 'market_view' | 'onboarding_complete',
//     marketId?: string, category?: string }
//
// Wallet + handle come from x-pm-wallet / x-pm-handle headers via the
// identity middleware; we never trust client-supplied wallet in the body.
// Anonymous calls (no wallet) are accepted and counted as anonymous visits.

import type { Request, Response } from 'express';
import { recordEvent, recordIdentity, type EventType } from '../analytics.js';

const ALLOWED: ReadonlySet<EventType> = new Set([
  'visit',
  'market_view',
  'onboarding_complete',
]);

export async function trackHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as { type?: string; marketId?: string; category?: string } | undefined;
  const type = body?.type;
  if (!type || !ALLOWED.has(type as EventType)) {
    res.status(400).json({ error: 'invalid event type' });
    return;
  }

  const wallet = req.identity?.wallet ?? null;
  const handle = req.identity?.handle ?? null;

  // Visit and onboarding_complete are the natural moments to refresh the
  // user row. market_view skips the identity write to keep the file tight.
  if (wallet && (type === 'visit' || type === 'onboarding_complete')) {
    void recordIdentity(wallet, handle);
  }

  await recordEvent({
    wallet,
    handle,
    type: type as EventType,
    ...(body?.marketId ? { marketId: String(body.marketId).slice(0, 128) } : {}),
    ...(body?.category ? { category: String(body.category).slice(0, 32) } : {}),
  });

  res.json({ ok: true });
}
