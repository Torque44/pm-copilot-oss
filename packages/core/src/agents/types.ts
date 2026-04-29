// Shared types for agents, SSE events, and the final Brief.

export type CitationKind = 'book' | 'whale' | 'news' | 'kol' | 'comp';

export type Citation = {
  id: string;                // e.g. "book·1", "whale·3", "news·2"
  kind: CitationKind;
  label: string;             // short human label shown in the pill (usually same as id)
  payload: unknown;          // raw source payload (book level, holder row, article)
  url?: string;
};

export type Claim = {
  text: string;              // may include pill placeholders like "{{book·1}}"; UI renders pills inline
  citations: string[];       // ordered list of citation IDs referenced by this claim
};

export type SectionOut = {
  claims: Claim[];
  citations: Citation[];
};

// --- Grounding data (streamed to the left rail before LLM finishes) ---

export type BookLevel = { price: number; size: number; cumulative?: number };

export type Category = 'sports' | 'crypto' | 'politics' | 'other';
export type Venue = 'polymarket' | 'kalshi' | 'limitless' | 'hyperliquid' | 'drift';

/**
 * MarketMeta is the per-OUTCOME contract — i.e. one Polymarket sub-market.
 * For binary events there's exactly one MarketMeta per event (the YES/NO pair).
 * For multi-outcome events there's one MarketMeta per candidate/option.
 *
 * Agents (market.ts, holders.ts, news.ts) operate on a single MarketMeta at a
 * time. The event-grouping logic lives at the rail level (EventMeta below).
 */
export type MarketMeta = {
  marketId: string;
  /** Optional link back to the parent event id from Gamma. */
  eventId?: string;
  /** Venue this market lives on. Used by the registry to pick the right feed. */
  venue?: Venue;
  title: string;
  endDate: string | null;
  category: Category;
  yes: number | null;
  no: number | null;
  volume24hr: number;
  volumeTotal: number;
  conditionId: string;
  tokenIdYes: string;
  tokenIdNo: string;
  slug: string;
  /** Human-facing resolution copy. The Gamma event's `description` is the
   *  authoritative source on Polymarket; markets inherit it from the parent.
   *  Optional because some venues won't provide it. */
  resolutionWording?: string | null;
  /** Where the market resolves from (e.g. UMA, Binance, Federal Reserve press). */
  resolutionSource?: string | null;
};

/**
 * Outcome — one row under an event. For a binary event this is just the YES
 * side of the single sub-market; for a multi-outcome event ("who wins X?")
 * each candidate is one Outcome.
 *
 * The marketId, conditionId and token IDs match the underlying GammaMarket so
 * agents can fetch orderbook / holders without remapping.
 */
export type Outcome = {
  marketId: string;          // sub-market id (Polymarket's market.id)
  label: string;              // e.g., "Trump", "Harris", "Yes", "No"
  yes: number | null;         // current YES price (probability for this outcome)
  tokenIdYes: string;
  tokenIdNo: string;
  volume24hr: number;
  volumeTotal: number;
  conditionId: string;
};

/**
 * EventMeta — Polymarket-native: an event is the parent question, and 1+
 * markets (sub-contracts) live under it. Binary events have one outcome,
 * multi-outcome events have N outcomes (one per candidate / option).
 */
export type EventMeta = {
  eventId: string;            // the parent event id from Gamma
  title: string;              // event title
  description?: string | null;
  endDate: string | null;
  category: Category;
  venue: Venue;
  isMultiOutcome: boolean;    // true if outcomes.length > 1 with distinct labels
  outcomes: Outcome[];        // all sub-markets/outcomes under this event
  totalVolume24hr: number;    // sum of outcomes
  totalVolumeAll: number;
  // Resolution details
  resolutionSource?: string | null;
  resolutionWording?: string | null;
};

export type BookGrounding = {
  kind: 'book';
  side: 'yes' | 'no';
  bids: BookLevel[];
  asks: BookLevel[];
  spread: number | null;
  mid: number | null;
  topDepthUsd: number;         // USD resting within 5¢ of mid, summed both sides
  slippage: { size: number; avgPrice: number | null; slippageC: number | null }[];
  raw?: unknown;
};

export type HolderRow = {
  address: string;
  side: 'yes' | 'no';
  sizeUsd: number;
  shares: number;
  label?: string;              // if ENS / venue username present
};

export type HoldersGrounding = {
  kind: 'holders';
  rows: HolderRow[];
  concentrationTop5Pct: number;
  totalHolderUsd: number;
  sideBias: { yesUsd: number; noUsd: number; yesPct: number };
  raw?: unknown;
};

export type NewsItem = {
  headline: string;
  source: string;
  url: string;
  publishedAt?: string;        // ISO date when available
  snippet?: string;
  /** How relevant this item is to the market resolution. */
  relevance?: 'high' | 'med' | 'low';
  /** Provenance — 'web' if found via search; 'training' when the model
   *  filled in from its own knowledge because search was thin. */
  from?: 'web' | 'training';
};

export type NewsGrounding = {
  kind: 'news';
  items: NewsItem[];
  /** Optional 1-2 sentence background blurb explaining what the market is
   *  really asking about. Useful when the topic is niche/obscure. */
  background?: string;
  raw?: unknown;
};

export type GroundingData = BookGrounding | HoldersGrounding | NewsGrounding;

// --- SSE events the Supervisor emits ---

export type AgentId = 'market' | 'holders' | 'news' | 'synthesis' | 'sentiment' | 'thesis' | 'ask' | 'comparables';

export type AgentEvent =
  | { t: 'agent:start'; agent: AgentId }
  | { t: 'agent:data'; agent: AgentId; grounding: GroundingData }
  | { t: 'agent:done'; agent: AgentId; elapsedMs: number; output: SectionOut }
  | { t: 'agent:error'; agent: AgentId; error: string; elapsedMs: number }
  | { t: 'brief:section'; name: BriefSectionName; claims: Claim[] }
  | { t: 'brief:complete'; brief: Brief }
  | { t: 'error'; error: string };

export type BriefSectionName = 'setup' | 'book' | 'smart' | 'catalysts' | 'verdict';

export type Brief = {
  sections: {
    setup: Claim[];
    book: Claim[];
    smart: Claim[];
    catalysts: Claim[];
    verdict: Claim[];
  };
  confidence: 'high' | 'med' | 'low';
  edge: 'yes' | 'no' | 'none';
  citations: Citation[];
  market: MarketMeta;
};

// --- Common agent contract ---

export type AgentContext = {
  market: MarketMeta;
  emit: (ev: AgentEvent) => void;
};

export type AgentResult = {
  agent: AgentId;
  output: SectionOut;
  grounding: GroundingData | null;  // raw data to show in rail (null if news and no data)
  elapsedMs: number;
  error?: string;
};
