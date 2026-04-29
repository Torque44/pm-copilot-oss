// useBrief — wraps useSSE for /api/brief?marketId=X and reduces the raw
// supervisor event stream into a UI-friendly BriefShape. Pure-derived state
// via useMemo so the reducer is replayable across reconnects.
//
// The server emits AgentEvent envelopes (see packages/core/src/agents/types.ts)
// plus a couple of meta envelopes ('market', 'cache'). We tolerate the
// superset and only key on `t`.

import { useEffect, useMemo, useState } from 'react';
import type {
  AgentStatus,
  BookRow,
  BriefShape,
  BriefAgents,
  BriefShapeSection,
  BriefClaim,
  Citation,
  CitationKind,
  HolderRow,
  Market,
  NewsItem,
} from '../types';
import { useSSE, type SSEState } from './useSSE';
import { buildBriefSSEUrl } from '../lib/client';
import { formatRelativeDuration, fmtMoney } from '../lib/format';

// Keys we track for agent status. Server today emits market/holders/news/
// synthesis; UI surfaces a few extra slots for future agents.
type ServerAgentId = 'market' | 'holders' | 'news' | 'sentiment' | 'thesis' | 'synthesis' | 'ask';

type BriefEventLike =
  | { t: 'market'; market: unknown }
  | { t: 'cache'; source?: string; ageMs?: number }
  | { t: 'agent:start'; agent: ServerAgentId }
  | { t: 'agent:done'; agent: ServerAgentId; output?: { claims?: unknown[]; citations?: unknown[] } }
  | { t: 'agent:error'; agent: ServerAgentId; error?: string }
  | { t: 'agent:data'; agent: ServerAgentId; grounding?: unknown }
  | { t: 'brief:section'; name: string; claims?: unknown[] }
  | { t: 'brief:complete'; brief?: { citations?: unknown[] } }
  | { t: 'cite'; citation: unknown }
  | { t: 'error'; error?: string };

const INITIAL_AGENTS: BriefAgents = {
  market: 'pending',
  holders: 'pending',
  news: 'pending',
  sentiment: 'pending',
  thesis: 'pending',
  synthesis: 'pending',
  ask: 'pending',
};

// Section title overrides for known agents (keeps panels human-readable).
const SECTION_TITLES: Record<string, string> = {
  market: 'Market',
  holders: 'Holders',
  news: 'News',
  sentiment: 'Sentiment',
  thesis: 'Thesis',
  synthesis: 'Synthesis',
  ask: 'Ask',
  setup: 'Setup',
  book: 'Book',
  smart: 'Smart Money',
  catalysts: 'Catalysts',
  verdict: 'Verdict',
};

function titleFor(id: string): string {
  return SECTION_TITLES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

function isClaim(x: unknown): x is BriefClaim {
  if (!x || typeof x !== 'object') return false;
  const o = x as { text?: unknown; citations?: unknown };
  return typeof o.text === 'string' && Array.isArray(o.citations);
}

function isCitation(x: unknown): x is Citation {
  if (!x || typeof x !== 'object') return false;
  const o = x as { id?: unknown; kind?: unknown };
  if (typeof o.id !== 'string') return false;
  const k = o.kind;
  return k === 'book' || k === 'whale' || k === 'news' || k === 'kol';
}

function asMarket(x: unknown): Market | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  // Server emits MarketMeta (slightly different shape than the UI Market).
  const id = typeof o['marketId'] === 'string'
    ? o['marketId']
    : typeof o['id'] === 'string'
      ? o['id']
      : null;
  if (!id) return null;
  const title = typeof o['title'] === 'string' ? o['title'] : '';
  const venue = typeof o['venue'] === 'string' ? o['venue'] : 'polymarket';
  const yes = typeof o['yes'] === 'number' ? o['yes'] : undefined;
  const no = typeof o['no'] === 'number' ? o['no'] : undefined;
  const volume24hr = typeof o['volume24hr'] === 'number' ? o['volume24hr'] : 0;
  const endDate = typeof o['endDate'] === 'string' ? o['endDate'] : '';
  // The server uses different names for the resolution copy depending on
  // source: Gamma sends `resolutionWording`, ported synthesizers send
  // `criteria`, and the event description is the last fallback.
  const criteria = (typeof o['resolutionWording'] === 'string' && o['resolutionWording'])
    || (typeof o['criteria'] === 'string' && o['criteria'])
    || (typeof o['description'] === 'string' && o['description'])
    || '';
  const m: Market = {
    id,
    venue,
    title,
    vol24h: volume24hr ? fmtMoney(volume24hr) : '—',
    resolveIn: formatRelativeDuration(endDate),
    criteria,
  };
  if (yes !== undefined) m.yes = yes;
  if (no !== undefined) m.no = no;
  return m;
}

// ---- grounding adapters ----

type RawBookLevel = { price?: number; size?: number; cumulative?: number };
type RawBookGrounding = { kind?: string; bids?: RawBookLevel[]; asks?: RawBookLevel[] };
type RawHolderRow = {
  address?: string;
  side?: string;
  sizeUsd?: number;
  shares?: number;
  label?: string;
};
type RawHoldersGrounding = {
  kind?: string;
  rows?: RawHolderRow[];
  concentrationTop5Pct?: number;
  totalHolderUsd?: number;
  sideBias?: { yesUsd?: number; noUsd?: number; yesPct?: number };
};
type RawNewsItem = {
  id?: string;
  headline?: string;
  title?: string;
  source?: string;
  src?: string;
  publishedAt?: string;
  when?: string;
  url?: string;
};
type RawNewsGrounding = { kind?: string; items?: RawNewsItem[] };

/** Polymarket's BookGrounding describes the YES book (bids/asks on YES).
 *  The design panel shows NO rows on top (= YES bids inverted) and YES rows
 *  on the bottom (= YES asks). IDs match supervisor citation IDs so click-
 *  to-flash on a `book-1b` pill highlights the corresponding row. */
function bookGroundingToRows(g: RawBookGrounding): BookRow[] {
  const rows: BookRow[] = [];
  const bids = Array.isArray(g.bids) ? g.bids.slice(0, 3) : [];
  const asks = Array.isArray(g.asks) ? g.asks.slice(0, 3) : [];
  bids.forEach((l, i) => {
    if (typeof l.price !== 'number' || typeof l.size !== 'number') return;
    rows.push({
      id: i === 0 ? 'book-1b' : `book-1b-${i + 1}`,
      side: 'NO',
      price: Number((1 - l.price).toFixed(3)),
      size: l.size,
      cum: l.cumulative ?? 0,
    });
  });
  asks.forEach((l, i) => {
    if (typeof l.price !== 'number' || typeof l.size !== 'number') return;
    rows.push({
      id: i === 0 ? 'book-1a' : `book-1a-${i + 1}`,
      side: 'YES',
      price: l.price,
      size: l.size,
      cum: l.cumulative ?? 0,
    });
  });
  return rows;
}

function holdersGroundingToRows(g: RawHoldersGrounding): HolderRow[] {
  const src = Array.isArray(g.rows) ? g.rows.slice(0, 6) : [];
  const yesPct = g.sideBias?.yesPct ?? null;
  return src.flatMap((r, i): HolderRow[] => {
    if (!r.address || typeof r.sizeUsd !== 'number') return [];
    const side: 'YES' | 'NO' = r.side === 'yes' ? 'YES' : 'NO';
    return [{
      id: `whale·${i + 1}`,
      rank: i + 1,
      address: r.address,
      side,
      size: r.sizeUsd,
      pctYes: side === 'YES' && yesPct != null ? Number(yesPct.toFixed(1)) : null,
    }];
  });
}

function newsGroundingToItems(g: RawNewsGrounding): NewsItem[] {
  const items = Array.isArray(g.items) ? g.items : [];
  return items.flatMap((n, i): NewsItem[] => {
    const id = typeof n.id === 'string' ? n.id : `news·${i + 1}`;
    const title = (typeof n.headline === 'string' && n.headline)
      || (typeof n.title === 'string' && n.title)
      || '';
    if (!title) return [];
    const item: NewsItem = {
      id,
      title,
      src: (typeof n.source === 'string' && n.source) || (typeof n.src === 'string' && n.src) || 'web',
      when: (typeof n.publishedAt === 'string' && n.publishedAt) || (typeof n.when === 'string' && n.when) || '',
    };
    if (typeof n.url === 'string') item.url = n.url;
    return [item];
  });
}

function reduce(events: BriefEventLike[]): BriefShape {
  let market: Market | null = null;
  let rawMarket: unknown = null;
  const agents: BriefAgents = { ...INITIAL_AGENTS };
  const sectionMap = new Map<string, BriefShapeSection>();
  const citationMap = new Map<string, Citation>();
  const errors: string[] = [];
  let bookRows: BookRow[] = [];
  let holderRows: HolderRow[] = [];
  let newsItems: NewsItem[] = [];
  let complete = false;

  const setAgent = (id: ServerAgentId, status: AgentStatus) => {
    if (id in agents) {
      agents[id as keyof BriefAgents] = status;
    }
  };

  const upsertSection = (id: string, claims: BriefClaim[]) => {
    const existing = sectionMap.get(id);
    if (existing) {
      existing.claims = claims.length ? claims : existing.claims;
    } else {
      sectionMap.set(id, { id, title: titleFor(id), claims });
    }
  };

  const addCitations = (raw: unknown[] | undefined) => {
    if (!Array.isArray(raw)) return;
    for (const c of raw) {
      if (isCitation(c)) {
        if (!citationMap.has(c.id)) citationMap.set(c.id, c);
      } else if (c && typeof c === 'object') {
        const o = c as { id?: unknown; kind?: unknown; label?: unknown; url?: unknown };
        if (typeof o.id === 'string') {
          const kind: CitationKind =
            o.kind === 'whale' || o.kind === 'news' || o.kind === 'kol' ? o.kind : 'book';
          const cit: Citation = { id: o.id, kind };
          if (typeof o.label === 'string') cit.label = o.label;
          if (typeof o.url === 'string') cit.url = o.url;
          if (!citationMap.has(cit.id)) citationMap.set(cit.id, cit);
        }
      }
    }
  };

  for (const ev of events) {
    if (!ev || typeof ev !== 'object' || typeof (ev as { t?: unknown }).t !== 'string') continue;
    switch (ev.t) {
      case 'market':
        market = asMarket(ev.market);
        rawMarket = ev.market;
        break;
      case 'agent:start':
        setAgent(ev.agent, 'running');
        break;
      case 'agent:done': {
        setAgent(ev.agent, 'done');
        const claimsRaw = ev.output?.claims;
        const claims: BriefClaim[] = Array.isArray(claimsRaw) ? claimsRaw.filter(isClaim) : [];
        upsertSection(ev.agent, claims);
        addCitations(ev.output?.citations);
        break;
      }
      case 'agent:error':
        setAgent(ev.agent, 'error');
        if (typeof ev.error === 'string' && ev.error) errors.push(`${ev.agent}: ${ev.error}`);
        break;
      case 'agent:data': {
        const g = ev.grounding as { kind?: string } | undefined;
        if (g && typeof g === 'object') {
          if (g.kind === 'book') bookRows = bookGroundingToRows(g as RawBookGrounding);
          else if (g.kind === 'holders') holderRows = holdersGroundingToRows(g as RawHoldersGrounding);
          else if (g.kind === 'news') newsItems = newsGroundingToItems(g as RawNewsGrounding);
        }
        break;
      }
      case 'brief:section': {
        const claimsRaw = ev.claims;
        const claims: BriefClaim[] = Array.isArray(claimsRaw) ? claimsRaw.filter(isClaim) : [];
        upsertSection(ev.name, claims);
        break;
      }
      case 'cite':
        addCitations([ev.citation]);
        break;
      case 'brief:complete':
        complete = true;
        addCitations(ev.brief?.citations);
        break;
      case 'error':
        if (typeof ev.error === 'string' && ev.error) errors.push(ev.error);
        break;
      case 'cache':
        // informational only
        break;
      default:
        break;
    }
  }

  return {
    market,
    rawMarket,
    agents,
    sections: Array.from(sectionMap.values()),
    citations: Array.from(citationMap.values()),
    bookRows,
    holderRows,
    newsItems,
    errors,
    complete,
  };
}

export type UseBriefResult = {
  brief: BriefShape;
  sseState: SSEState;
  reconnect: () => void;
};

export function useBrief(marketId: string | null): UseBriefResult {
  // buildBriefSSEUrl is async (reads keys from IndexedDB). We resolve it in
  // an effect and feed the resulting URL to useSSE. Until it resolves the
  // url is null so useSSE stays idle — no flash-of-no-key request.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!marketId) {
      setUrl(null);
      return;
    }
    void buildBriefSSEUrl(marketId).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [marketId]);

  const { events, state, reconnect } = useSSE<BriefEventLike>(url);
  const brief = useMemo<BriefShape>(() => reduce(events), [events]);

  return { brief, sseState: state, reconnect };
}
