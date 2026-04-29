// Polymarket public API client.
// Gamma:  market/event discovery + metadata
// CLOB:   orderbook + trades + prices
// Data:   holders (aggregated by outcome)
//
// All endpoints are public (no auth). We proxy through the Node backend
// because Polymarket does not set CORS headers for browser origins.

import type {
  MarketMeta,
  HolderRow,
  BookLevel,
  EventMeta,
  Outcome,
  Category,
} from '../agents/types';
import { getJson } from './http';

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
const DATA = 'https://data-api.polymarket.com';

async function get<T>(url: string): Promise<T> {
  return getJson<T>(url);
}

// --- Gamma types (partial — only what we use) ---

export type GammaMarket = {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  endDate: string;
  outcomes: string;            // JSON-stringified ["Yes", "No"]
  outcomePrices: string;       // JSON-stringified ["0.16", "0.84"]
  clobTokenIds: string;        // JSON-stringified [tokenYes, tokenNo]
  volume: string;
  volume24hr?: number;
  volumeNum?: number;
  liquidity?: string;
  liquidityNum?: number;
  active: boolean;
  closed: boolean;
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
  lastTradePrice?: number;
  groupItemTitle?: string;
};

export type GammaEvent = {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  description?: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  featured?: boolean;
  volume24hr?: number;
  volume: number;
  openInterest?: number;
  resolutionSource?: string;
  markets: GammaMarket[];
  tags?: { id: number; label: string; slug: string }[];
};

// Tag slugs we treat as first-class categories. 'other' is a fallback (no tag).
export type PolyTag = 'sports' | 'crypto' | 'politics';

// --- public API ---

export async function listEventsByTag(
  tagSlug: PolyTag,
  limit = 20
): Promise<GammaEvent[]> {
  const url = `${GAMMA}/events?active=true&closed=false&tag_slug=${tagSlug}&order=volume24hr&ascending=false&limit=${limit}`;
  return get<GammaEvent[]>(url);
}

/** Top events across the platform (no tag filter). Used for the "Other" tab. */
export async function listEventsAll(limit = 20): Promise<GammaEvent[]> {
  const url = `${GAMMA}/events?active=true&closed=false&order=volume24hr&ascending=false&limit=${limit}`;
  return get<GammaEvent[]>(url);
}

export async function getEvent(id: string): Promise<GammaEvent> {
  // Gamma doesn't expose /events/:id directly — use the array filter endpoint
  const arr = await get<GammaEvent[]>(`${GAMMA}/events?id=${id}`);
  if (!arr?.length) throw new Error(`event ${id} not found`);
  return arr[0]!;
}

/** Resolve a Polymarket event slug to a GammaEvent (no order/closed filters
 *  so resolved markets still surface for inspection). */
export async function getEventBySlug(slug: string): Promise<GammaEvent | null> {
  const arr = await get<GammaEvent[]>(`${GAMMA}/events?slug=${encodeURIComponent(slug)}&limit=1`);
  return arr?.[0] ?? null;
}

export type BookResponse = {
  market: string;
  asset_id: string;
  timestamp?: string;
  hash?: string;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
  tick_size?: string;
  min_order_size?: string;
  neg_risk?: boolean;
  last_trade_price?: string | number;
};

export async function getBook(tokenId: string): Promise<BookResponse> {
  return get<BookResponse>(`${CLOB}/book?token_id=${tokenId}`);
}

export type HoldersGroup = {
  token: string;
  holders: {
    proxyWallet: string;
    bio?: string;
    asset: string;
    pseudonym?: string;
    name?: string;
    amount: number;       // shares held
    outcomeIndex: 0 | 1;
    displayUsernamePublic?: boolean;
  }[];
};

export async function getHolders(conditionId: string, limit = 20): Promise<HoldersGroup[]> {
  return get<HoldersGroup[]>(`${DATA}/holders?market=${conditionId}&limit=${limit}`);
}

// --- helpers: pick the best binary sub-market and normalize to MarketMeta ---

function parseJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/**
 * From an event's markets[], pick the sub-market with the most volume and an open book.
 * Returns null if no usable sub-market.
 */
export function pickBestSubMarket(ev: GammaEvent): GammaMarket | null {
  const candidates = ev.markets.filter(m =>
    m.active && !m.closed && m.enableOrderBook !== false && m.acceptingOrders !== false
  );
  if (!candidates.length) return null;
  // Prefer by 24h volume, fall back to all-time
  candidates.sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0) || Number(b.volume ?? 0) - Number(a.volume ?? 0));
  return candidates[0] ?? null;
}

export function gammaToMarketMeta(
  ev: GammaEvent,
  m: GammaMarket,
  category: Category
): MarketMeta {
  const tokens = parseJson<string[]>(m.clobTokenIds, []);
  const prices = parseJson<string[]>(m.outcomePrices, []);

  // Event-level title is usually the question umbrella (e.g. "Bitcoin above ___ on April 21?").
  // Sub-market question is the specific binary. Combine when they differ.
  const subQ = m.question?.trim();
  const evT = ev.title?.trim();
  const title = subQ && subQ !== evT ? subQ : evT;

  return {
    marketId: m.id,
    eventId: ev.id,
    venue: 'polymarket',
    title,
    endDate: m.endDate ?? ev.endDate ?? null,
    category,
    yes: prices[0] != null ? Number(prices[0]) : (m.lastTradePrice ?? null),
    no: prices[1] != null ? Number(prices[1]) : null,
    volume24hr: m.volume24hr ?? 0,
    volumeTotal: Number(m.volume ?? 0),
    conditionId: m.conditionId,
    tokenIdYes: tokens[0] ?? '',
    tokenIdNo: tokens[1] ?? '',
    slug: m.slug,
    // Inherit resolution copy from the parent event so the workbench can
    // surface the criteria string without a second fetch.
    resolutionWording: ev.description ?? null,
    resolutionSource: ev.resolutionSource ?? null,
  };
}

/**
 * Normalize a single GammaMarket to an Outcome row (one option under an event).
 * Returns null if the sub-market is unusable (closed / no token IDs).
 */
function gammaMarketToOutcome(m: GammaMarket): Outcome | null {
  if (!m.active || m.closed) return null;
  if (m.enableOrderBook === false || m.acceptingOrders === false) return null;
  const tokens = parseJson<string[]>(m.clobTokenIds, []);
  const prices = parseJson<string[]>(m.outcomePrices, []);
  if (!tokens[0] || !tokens[1]) return null;

  // Prefer sub-market's groupItemTitle (e.g. "Trump", "Harris") for multi-outcome
  // events; fall back to the question itself for binaries.
  const labelRaw = m.groupItemTitle?.trim() || m.question?.trim() || 'Yes';

  return {
    marketId: m.id,
    label: labelRaw,
    yes: prices[0] != null ? Number(prices[0]) : (m.lastTradePrice ?? null),
    tokenIdYes: tokens[0],
    tokenIdNo: tokens[1],
    volume24hr: m.volume24hr ?? 0,
    volumeTotal: Number(m.volume ?? 0),
    conditionId: m.conditionId,
  };
}

/**
 * Convert a Gamma event into our event-centric `EventMeta`, preserving ALL
 * outcomes (not just the top sub-market). For binary events `outcomes` will
 * have length 1 (the YES/NO pair), `isMultiOutcome` is false. For multi-
 * outcome events `outcomes` lists each candidate.
 *
 * Returns null if the event has no usable sub-markets.
 */
export function gammaToEventMeta(
  ev: GammaEvent,
  category: Category
): EventMeta | null {
  const outcomes: Outcome[] = [];
  for (const m of ev.markets) {
    const o = gammaMarketToOutcome(m);
    if (o) outcomes.push(o);
  }
  if (!outcomes.length) return null;

  // Sort outcomes by 24h volume desc so the top option leads.
  outcomes.sort((a, b) => (b.volume24hr - a.volume24hr) || (b.volumeTotal - a.volumeTotal));

  // A multi-outcome event is one where there are >=2 outcomes with *distinct*
  // labels. (A binary event registered as one sub-market shouldn't be flagged.)
  const distinctLabels = new Set(outcomes.map(o => o.label.toLowerCase()));
  const isMultiOutcome = outcomes.length > 1 && distinctLabels.size > 1;

  const totalVolume24hr = outcomes.reduce((s, o) => s + (o.volume24hr ?? 0), 0);
  const totalVolumeAll = outcomes.reduce((s, o) => s + (o.volumeTotal ?? 0), 0);

  // Resolution wording: Polymarket exposes resolutionSource on event and
  // sometimes a "resolution" / description blob on the market. Keep it simple
  // and surface what the event has.
  const resolutionSource = ev.resolutionSource ?? null;
  const resolutionWording = ev.description ?? null;

  return {
    eventId: ev.id,
    title: ev.title,
    description: ev.description ?? null,
    endDate: ev.endDate ?? null,
    category,
    venue: 'polymarket',
    isMultiOutcome,
    outcomes,
    totalVolume24hr,
    totalVolumeAll,
    resolutionSource,
    resolutionWording,
  };
}

// --- computed helpers used by agents ---

export function normaliseBook(raw: BookResponse): {
  bids: BookLevel[];
  asks: BookLevel[];
  spread: number | null;
  mid: number | null;
} {
  const bids = raw.bids
    .map(b => ({ price: Number(b.price), size: Number(b.size) }))
    .filter(b => Number.isFinite(b.price) && Number.isFinite(b.size) && b.size > 0)
    .sort((a, b) => b.price - a.price); // high → low
  const asks = raw.asks
    .map(a => ({ price: Number(a.price), size: Number(a.size) }))
    .filter(a => Number.isFinite(a.price) && Number.isFinite(a.size) && a.size > 0)
    .sort((a, b) => a.price - b.price); // low → high

  const topBid = bids[0]?.price ?? null;
  const topAsk = asks[0]?.price ?? null;
  const spread = topBid != null && topAsk != null ? Number((topAsk - topBid).toFixed(4)) : null;
  const mid = topBid != null && topAsk != null ? Number(((topAsk + topBid) / 2).toFixed(4)) : null;

  // add cumulative running totals
  let cum = 0;
  for (const l of bids) { cum += l.size; (l as BookLevel).cumulative = cum; }
  cum = 0;
  for (const l of asks) { cum += l.size; (l as BookLevel).cumulative = cum; }

  return { bids, asks, spread, mid };
}

/**
 * Depth in USD within +/- window (in cents) of the mid. Sums both sides.
 */
export function depthWithin(
  bids: BookLevel[],
  asks: BookLevel[],
  mid: number,
  cents: number
): number {
  const windowLo = mid - cents / 100;
  const windowHi = mid + cents / 100;
  let usd = 0;
  for (const b of bids) {
    if (b.price >= windowLo) usd += b.price * b.size;
  }
  for (const a of asks) {
    if (a.price <= windowHi) usd += a.price * a.size;
  }
  return Math.round(usd);
}

/**
 * Simulate a market BUY of `sizeUsd` worth of YES by walking the ask side.
 * Returns { avgPrice, slippageC (cents vs top ask) }. null if book cannot fill.
 */
export function simulateBuy(asks: BookLevel[], sizeUsd: number): { avgPrice: number | null; slippageC: number | null } {
  if (!asks.length) return { avgPrice: null, slippageC: null };
  let remainingUsd = sizeUsd;
  let sharesFilled = 0;
  let costUsd = 0;
  for (const level of asks) {
    if (remainingUsd <= 0) break;
    const levelUsd = level.price * level.size;
    if (levelUsd >= remainingUsd) {
      const sharesAtLevel = remainingUsd / level.price;
      sharesFilled += sharesAtLevel;
      costUsd += remainingUsd;
      remainingUsd = 0;
    } else {
      sharesFilled += level.size;
      costUsd += levelUsd;
      remainingUsd -= levelUsd;
    }
  }
  if (remainingUsd > 0.01) {
    // book too thin to fill
    return { avgPrice: null, slippageC: null };
  }
  const avgPrice = costUsd / sharesFilled;
  const topAsk = asks[0]!.price;
  const slippageC = Number(((avgPrice - topAsk) * 100).toFixed(2));
  return { avgPrice: Number(avgPrice.toFixed(4)), slippageC };
}

/**
 * Flatten + normalize holders into a single top-N list (both outcomes together).
 */
export function normaliseHolders(
  groups: HoldersGroup[],
  midYes: number | null,
  topN = 20
): HolderRow[] {
  const rows: HolderRow[] = [];
  for (const g of groups) {
    for (const h of g.holders) {
      const side: 'yes' | 'no' = h.outcomeIndex === 0 ? 'yes' : 'no';
      const pxGuess = midYes != null ? (side === 'yes' ? midYes : 1 - midYes) : 0.5;
      const sizeUsd = h.amount * pxGuess;
      rows.push({
        address: h.proxyWallet,
        side,
        sizeUsd: Math.round(sizeUsd),
        shares: h.amount,
        label: h.displayUsernamePublic ? (h.name || h.pseudonym || undefined) : undefined,
      });
    }
  }
  rows.sort((a, b) => b.sizeUsd - a.sizeUsd);
  return rows.slice(0, topN);
}
