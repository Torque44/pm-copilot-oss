// GET /api/markets         — top sports + top crypto market
// GET /api/market?id=...    — single market lookup (cache-only)
// GET /api/markets-list     — flat list of binary markets (legacy, kept for back-compat)
// GET /api/events           — event-centric list with all outcomes nested
//
// All endpoints are cached for 5 minutes per (category, params) tuple.

import type { Request, Response } from 'express';
import {
  listEventsByTag,
  listEventsAll,
  pickBestSubMarket,
  gammaToMarketMeta,
  gammaToEventMeta,
  type GammaEvent,
} from '@pm-copilot/core/feeds/polymarket';
import { cached } from '../cache.js';
import type { MarketMeta, EventMeta, Category } from '@pm-copilot/core';

const TTL_MS = 5 * 60 * 1000;

/**
 * Legacy "primary" categories Polymarket exposes via `tag_slug`. The 'other'
 * bucket is a fallback that pulls top-volume events with no tag filter.
 */
type ApiCategory = Exclude<Category, 'other'> | 'other';

function parseCategory(raw: unknown, fallback: ApiCategory = 'sports'): ApiCategory {
  const v = String(raw ?? '');
  if (v === 'sports' || v === 'crypto' || v === 'politics' || v === 'other') return v;
  return fallback;
}

async function fetchEventsForCategory(category: ApiCategory, limit: number): Promise<GammaEvent[]> {
  if (category === 'other') return listEventsAll(limit);
  return listEventsByTag(category, limit);
}

async function topMarketForTag(tag: 'sports' | 'crypto'): Promise<MarketMeta | null> {
  return cached(`topmarket:${tag}`, TTL_MS, async () => {
    const events = await listEventsByTag(tag, 25);
    for (const ev of events) {
      const m = pickBestSubMarket(ev);
      if (!m) continue;
      if (!m.clobTokenIds) continue;
      const meta = gammaToMarketMeta(ev, m, tag);
      if (!meta.tokenIdYes || !meta.tokenIdNo) continue;
      return meta;
    }
    return null;
  });
}

export async function getMarketsHandler(_req: Request, res: Response) {
  try {
    const [sports, crypto] = await Promise.all([
      topMarketForTag('sports'),
      topMarketForTag('crypto'),
    ]);
    res.json({ sports, crypto });
  } catch (err: unknown) {
    console.error('[markets] error', err);
    res.status(500).json({ error: errMsg(err) });
  }
}

// GET /api/market?id=<marketId>
// Fetches a single market by its gamma market id (used when client re-selects).
export async function getMarketByIdHandler(req: Request, res: Response) {
  try {
    const id = String(req.query.id ?? '');
    if (!id) return res.status(400).json({ error: 'missing id' });
    // Simplest path: search both categories' cached lists
    const [sports, crypto] = await Promise.all([
      topMarketForTag('sports'),
      topMarketForTag('crypto'),
    ]);
    const found = [sports, crypto].find(m => m?.marketId === id);
    if (!found) return res.status(404).json({ error: 'not found in cache' });
    res.json(found);
  } catch (err: unknown) {
    res.status(500).json({ error: errMsg(err) });
  }
}

// GET /api/markets-list?category=sports|crypto|politics|other&limit=8&mode=contested|all
// Returns a ranked list of binary markets in the given category.
//
// Ranking:
//  - mode=contested (DEFAULT): markets with 0.30 <= yes <= 0.70 rank first.
//  - mode=all: pure 24h-volume ranking.
//
// For multi-outcome events, this endpoint flattens to ONE outcome (the best
// sub-market via pickBestSubMarket). Use /api/events to get the full picture.
async function listMarketsForCategory(
  category: ApiCategory,
  limit = 8,
  mode: 'contested' | 'all' = 'contested'
): Promise<MarketMeta[]> {
  return cached(`markets-list:${category}:${limit}:${mode}`, TTL_MS, async () => {
    // Polymarket Gamma's tag-filtered events endpoint reliably 500s above
    // ~100 results, so cap the upstream pool. Bucket-sorting top-N stays
    // statistically fine because limit is typically ≤ 80.
    const candidatePool = mode === 'contested'
      ? Math.min(100, Math.max(50, limit * 2))
      : Math.min(100, Math.max(40, limit * 2));
    const events = await fetchEventsForCategory(category, candidatePool);

    const all: MarketMeta[] = [];
    for (const ev of events) {
      const m = pickBestSubMarket(ev);
      if (!m) continue;
      if (!m.clobTokenIds) continue;
      const meta = gammaToMarketMeta(ev, m, category);
      if (!meta.tokenIdYes || !meta.tokenIdNo) continue;
      all.push(meta);
    }

    if (mode === 'all') return all.slice(0, limit);

    // mode=contested: bucket + sort
    const isContested = (m: MarketMeta) => m.yes != null && m.yes >= 0.30 && m.yes <= 0.70;
    const distFromMid = (m: MarketMeta) => Math.abs((m.yes ?? 0.5) - 0.5);
    const vol = (m: MarketMeta) => m.volume24hr ?? 0;

    const contested = all
      .filter(isContested)
      .sort((a, b) => {
        const d = distFromMid(a) - distFromMid(b);
        if (d !== 0) return d;
        return vol(b) - vol(a);
      });
    const extreme = all
      .filter((m) => !isContested(m))
      .sort((a, b) => vol(b) - vol(a));

    return [...contested, ...extreme].slice(0, limit);
  });
}

export async function getMarketsListHandler(req: Request, res: Response) {
  try {
    const category = parseCategory(req.query.category, 'sports');
    const limit = Math.min(60, Math.max(1, Number(req.query.limit ?? 8)));
    const modeRaw = String(req.query.mode ?? 'contested');
    const mode = (modeRaw === 'all' ? 'all' : 'contested') as 'contested' | 'all';
    const markets = await listMarketsForCategory(category, limit, mode);
    res.json({ category, mode, markets });
  } catch (err: unknown) {
    res.status(500).json({ error: errMsg(err) });
  }
}

// GET /api/events?category=sports|crypto|politics|other&limit=20&mode=contested|all
// Returns a list of EventMeta — events with all outcomes nested.
async function listEventsForCategory(
  category: ApiCategory,
  limit = 20,
  mode: 'contested' | 'all' = 'contested'
): Promise<EventMeta[]> {
  return cached(`events-list:${category}:${limit}:${mode}`, TTL_MS, async () => {
    // Cap upstream pool at 100 (Gamma 500s above that on tag filters).
    const candidatePool = mode === 'contested'
      ? Math.min(100, Math.max(50, limit * 2))
      : Math.min(100, Math.max(40, limit * 2));
    const events = await fetchEventsForCategory(category, candidatePool);

    const all: EventMeta[] = [];
    for (const ev of events) {
      const meta = gammaToEventMeta(ev, category);
      if (!meta) continue;
      all.push(meta);
    }

    if (mode === 'all') {
      // Sort by total 24h volume desc.
      all.sort((a, b) => b.totalVolume24hr - a.totalVolume24hr);
      return all.slice(0, limit);
    }

    // mode=contested: prefer events whose top outcome is between 0.30 and 0.70
    // (i.e. there's a debate). Multi-outcome events are always considered
    // contested (multiple candidates by definition).
    const isContested = (e: EventMeta) => {
      if (e.isMultiOutcome) return true;
      const top = e.outcomes[0];
      return top?.yes != null && top.yes >= 0.30 && top.yes <= 0.70;
    };
    const distFromMid = (e: EventMeta) => {
      if (e.isMultiOutcome) return 0;
      return Math.abs((e.outcomes[0]?.yes ?? 0.5) - 0.5);
    };

    const contested = all
      .filter(isContested)
      .sort((a, b) => {
        const d = distFromMid(a) - distFromMid(b);
        if (d !== 0) return d;
        return b.totalVolume24hr - a.totalVolume24hr;
      });
    const extreme = all
      .filter((e) => !isContested(e))
      .sort((a, b) => b.totalVolume24hr - a.totalVolume24hr);

    return [...contested, ...extreme].slice(0, limit);
  });
}

export async function getEventsListHandler(req: Request, res: Response) {
  try {
    const category = parseCategory(req.query.category, 'sports');
    const limit = Math.min(80, Math.max(1, Number(req.query.limit ?? 20)));
    const modeRaw = String(req.query.mode ?? 'contested');
    const mode = (modeRaw === 'all' ? 'all' : 'contested') as 'contested' | 'all';
    const events = await listEventsForCategory(category, limit, mode);
    res.json({ category, mode, events });
  } catch (err: unknown) {
    res.status(500).json({ error: errMsg(err) });
  }
}

function errMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? 'unknown');
  }
  return 'unknown';
}
