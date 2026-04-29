// GET /api/resolve?url=<polymarket url>
//
// Takes a Polymarket URL (event or market) and resolves it to a marketId
// that the workbench can load via /m/:marketId. Supports:
//   https://polymarket.com/event/<event-slug>
//   https://polymarket.com/event/<event-slug>/<market-slug>
//   https://polymarket.com/markets/<market-slug>
//
// Returns: { marketId, eventId, title, slug } or 404 if unresolvable.

import type { Request, Response } from 'express';
import { getEventBySlug, pickBestSubMarket } from '@pm-copilot/core/feeds/polymarket';

type SlugPattern = { kind: 'event-market' | 'event' | 'market'; re: RegExp };

const URL_PATTERNS: SlugPattern[] = [
  // Order matters: more specific first.
  { kind: 'event-market', re: /polymarket\.com\/event\/([^/?#]+)\/([^/?#]+)/i },
  { kind: 'event',        re: /polymarket\.com\/event\/([^/?#]+)/i },
  { kind: 'market',       re: /polymarket\.com\/markets\/([^/?#]+)/i },
];

function extractSlugs(input: string): { eventSlug?: string; marketSlug?: string } {
  for (const { kind, re } of URL_PATTERNS) {
    const m = re.exec(input);
    if (!m) continue;
    if (kind === 'event-market') return { eventSlug: m[1]!, marketSlug: m[2]! };
    if (kind === 'event') return { eventSlug: m[1]! };
    if (kind === 'market') return { marketSlug: m[1]! };
  }
  // Last-ditch: caller may have just pasted a bare slug.
  const trimmed = input.trim();
  if (/^[a-z0-9-]+$/i.test(trimmed)) return { eventSlug: trimmed };
  return {};
}

export async function resolveHandler(req: Request, res: Response) {
  const raw = String(req.query['url'] ?? '').trim();
  if (!raw) {
    res.status(400).json({ error: 'missing url query param' });
    return;
  }

  const { eventSlug, marketSlug } = extractSlugs(raw);
  if (!eventSlug && !marketSlug) {
    res.status(400).json({ error: `not a recognised polymarket url: ${raw}` });
    return;
  }

  // Strategy: try the event-slug first (Polymarket's canonical URL form).
  // If we get an event, pick the matching sub-market (by slug if provided)
  // or fall back to pickBestSubMarket (highest 24h volume).
  if (eventSlug) {
    try {
      const ev = await getEventBySlug(eventSlug);
      if (!ev) {
        res.status(404).json({ error: `event slug not found: ${eventSlug}` });
        return;
      }
      let market = pickBestSubMarket(ev);
      if (marketSlug) {
        const matched = ev.markets.find((m) => m.slug === marketSlug);
        if (matched) market = matched;
      }
      if (!market) {
        res.status(404).json({ error: `event ${eventSlug} has no active sub-market` });
        return;
      }
      res.json({
        marketId: market.id,
        eventId: ev.id,
        title: ev.title,
        slug: market.slug,
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `gamma lookup failed: ${msg}` });
      return;
    }
  }

  // /markets/<slug> — Polymarket doesn't expose a market-slug-only filter on
  // Gamma; surface the slug so the client can fall back to a manual search.
  res.status(501).json({
    error: 'market-slug-only URLs are not yet resolvable; paste the /event/ link instead',
    marketSlug,
  });
}
