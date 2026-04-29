// ComparablesAgent — surfaces resolved Polymarket markets with similar
// resolution shape to the current contract, plus their actual outcomes,
// so traders get a base-rate anchor.
//
// Strategy:
//  1. Extract keywords from the current market title (entities + numbers).
//  2. Query Gamma's events endpoint for resolved markets in the same
//     category that share keywords.
//  3. Score by keyword overlap + recency, take top 5.
//  4. Emit as [comp·N] citations + a SectionOut whose claims describe
//     each comparable's outcome.
//
// We deliberately do NOT call an LLM here — comparables are deterministic.
// The thesis agent reads them via the `evidenceClaimSummary` and weaves
// them into its base-rate paragraph.

import type {
  AgentContext,
  AgentResult,
  Citation,
  Claim,
  SectionOut,
} from './types';
import { listEventsByTag, listEventsAll, type GammaEvent, type PolyTag } from '../feeds/polymarket';

const POLY_TAGS: readonly PolyTag[] = ['crypto', 'sports', 'politics'];

// Stop words we don't want to use as comparison keywords. Conservative list —
// we'd rather match too many candidates than miss a niche topic.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'of',
  'on', 'or', 'the', 'to', 'will', 'with', 'when', 'what', 'how', 'who',
  'has', 'have', 'do', 'does', 'did', 'this', 'that', 'these', 'those',
  'next', 'first', 'last', 'price', 'market', 'before', 'after', 'between',
  'reach', 'reaches', 'hit', 'hits', 'win', 'wins', 'won', 'lose', 'loses',
  'lost', 'cross', 'crosses', 'beat', 'beats', 'above', 'below', 'over',
  'under', 'than', 'more', 'less',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

export type ComparableHit = {
  /** Polymarket event id. */
  eventId: string;
  /** Event title. */
  title: string;
  /** End date ISO (when the event resolved, or close to it). */
  endDate: string | null;
  /** "yes" if it resolved YES, "no" if NO, "unresolved" otherwise. */
  outcome: 'yes' | 'no' | 'unresolved';
  /** Strongest outcome's price at resolution (yes-side) — or null. */
  resolvedPrice: number | null;
  /** Slug for building the polymarket URL. */
  slug?: string;
  /** Keyword overlap score (informational). */
  score: number;
};

export type ComparablesInput = {
  marketTitle: string;
  category: string;
};

/**
 * Pull comparables for the current market. Pure HTTP — no LLM call.
 */
export async function runComparablesAgent(
  ctx: AgentContext,
  input: ComparablesInput,
): Promise<AgentResult> {
  const started = Date.now();
  const tokens = new Set(tokenize(input.marketTitle));
  if (tokens.size === 0) {
    return emptyResult(started, 'no useful keywords in market title');
  }

  // Pull a wide candidate pool for the same category. We accept resolved
  // markets here (closed=true also surfaces them via Gamma's order param).
  let candidates: GammaEvent[] = [];
  try {
    if ((POLY_TAGS as readonly string[]).includes(input.category)) {
      candidates = await listEventsByTag(input.category as PolyTag, 100);
    } else {
      candidates = await listEventsAll(100);
    }
  } catch (err) {
    return emptyResult(started, `gamma fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Score each candidate by keyword overlap with the title.
  const scored: ComparableHit[] = [];
  for (const ev of candidates) {
    const evTokens = new Set(tokenize(ev.title || ''));
    let score = 0;
    for (const t of tokens) if (evTokens.has(t)) score += 1;
    if (score === 0) continue;
    // Skip the current market itself (same title).
    if ((ev.title || '').toLowerCase() === input.marketTitle.toLowerCase()) continue;

    const outcome = inferOutcome(ev);
    scored.push({
      eventId: ev.id,
      title: ev.title,
      endDate: ev.endDate ?? null,
      outcome,
      resolvedPrice: pickResolvedPrice(ev),
      ...(ev.slug ? { slug: ev.slug } : {}),
      score,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Prefer resolved over unresolved comparables (real outcomes anchor base rates).
    const ra = a.outcome === 'unresolved' ? 0 : 1;
    const rb = b.outcome === 'unresolved' ? 0 : 1;
    return rb - ra;
  });

  const top = scored.slice(0, 5);
  if (top.length === 0) {
    return emptyResult(started, 'no comparable markets found');
  }

  const yesCount = top.filter((c) => c.outcome === 'yes').length;
  const noCount = top.filter((c) => c.outcome === 'no').length;
  const unresolved = top.length - yesCount - noCount;
  const resolved = yesCount + noCount;
  const baseRate = resolved > 0 ? yesCount / resolved : null;

  const citations: Citation[] = top.map((c, i) => ({
    id: `comp·${i + 1}`,
    kind: 'comp',
    label: c.title.slice(0, 80),
    payload: c,
    url: c.slug ? `https://polymarket.com/event/${c.slug}` : undefined,
  }));

  const claims: Claim[] = [];
  if (baseRate != null) {
    claims.push({
      text: `Of ${resolved} comparable resolved markets, ${yesCount} resolved YES (${Math.round(baseRate * 100)}% base rate).${unresolved > 0 ? ` ${unresolved} still unresolved.` : ''}`,
      citations: top.map((_, i) => `comp·${i + 1}`),
    });
  } else {
    claims.push({
      text: `${top.length} comparable markets surfaced; none have resolved yet — base rate not yet anchored.`,
      citations: top.map((_, i) => `comp·${i + 1}`),
    });
  }
  for (const [i, c] of top.entries()) {
    const verdict =
      c.outcome === 'yes' ? 'resolved YES'
      : c.outcome === 'no' ? 'resolved NO'
      : c.resolvedPrice != null ? `unresolved · YES @ ${(c.resolvedPrice * 100).toFixed(0)}%`
      : 'unresolved';
    claims.push({
      text: `${c.title.toLowerCase()} — ${verdict}.`,
      citations: [`comp·${i + 1}`],
    });
  }

  const output: SectionOut = { claims, citations };
  void ctx;
  return {
    agent: 'comparables',
    output,
    grounding: null,
    elapsedMs: Date.now() - started,
  };
}

function emptyResult(started: number, reason: string): AgentResult {
  return {
    agent: 'comparables',
    output: {
      claims: [{ text: `no comparables: ${reason}`, citations: [] }],
      citations: [],
    },
    grounding: null,
    elapsedMs: Date.now() - started,
  };
}

/** Infer YES/NO/unresolved from Gamma's event payload. Polymarket marks
 *  resolved markets with `closed=true`; the winning side has price → 1.0. */
function inferOutcome(ev: GammaEvent): 'yes' | 'no' | 'unresolved' {
  if (!ev.closed) return 'unresolved';
  const ms = ev.markets || [];
  // Find the strongest market by 24h or all-time volume; use its outcomePrices.
  let best: { price: number | null; volume: number } = { price: null, volume: -1 };
  for (const m of ms) {
    const v = (m.volume24hr ?? 0) + Number(m.volume ?? 0);
    if (v <= best.volume) continue;
    let yes: number | null = null;
    try {
      const p = JSON.parse(m.outcomePrices || '[]') as unknown[];
      const first = p[0];
      if (typeof first === 'string') yes = Number(first);
      else if (typeof first === 'number') yes = first;
    } catch {
      /* skip */
    }
    if (yes == null && typeof m.lastTradePrice === 'number') yes = m.lastTradePrice;
    best = { price: yes, volume: v };
  }
  if (best.price == null) return 'unresolved';
  if (best.price >= 0.95) return 'yes';
  if (best.price <= 0.05) return 'no';
  return 'unresolved';
}

function pickResolvedPrice(ev: GammaEvent): number | null {
  const ms = ev.markets || [];
  for (const m of ms) {
    try {
      const p = JSON.parse(m.outcomePrices || '[]') as unknown[];
      const first = p[0];
      if (typeof first === 'string') return Number(first);
      if (typeof first === 'number') return first;
    } catch {
      /* skip */
    }
    if (typeof m.lastTradePrice === 'number') return m.lastTradePrice;
  }
  return null;
}
