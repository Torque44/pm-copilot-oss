// Shared TypeScript types for pm-copilot-oss web app.
// All UI components consume these — keep them stable and prop-driven.

export type Outcome = {
  name: string;
  yes: number;
  no: number;
};

export type Market = {
  id: string;
  venue: string;
  title: string;
  yes?: number;
  no?: number;
  multi?: boolean;
  outcomes?: Outcome[];
  vol24h: string;
  resolveIn: string;
  criteria: string;
  moreCount?: number;
};

export type EventOutcome = {
  id: string;
  name: string;
  price: number;
  /** 24h dollar volume on this specific outcome (sub-market). */
  volume24hr?: number;
};

export type EventSummary = {
  id: string;
  title: string;
  category: string;
  /** Polymarket tag slugs attached to this event (iran, ai, geopolitics,
   *  middle-east, …). Drives the fine-grained tab filter beyond the four
   *  canonical categories. */
  tagSlugs?: string[];
  marketCount: number;
  outcomes: EventOutcome[];
  /** Aggregate 24h volume across all outcomes (event level). */
  volume24hr?: number;
  /** ISO end date — drives the countdown badge. */
  endDate?: string | null;
  /** True for events with multiple distinct candidates ("who wins X?"). */
  isMultiOutcome?: boolean;
};

export type CitationKind = 'book' | 'whale' | 'news' | 'kol' | 'comp';

export type Citation = {
  id: string;
  kind: CitationKind;
  label?: string;
  url?: string;
};

export type BriefSection = {
  heading: string;
  body: string;
  citationIds?: string[];
};

export type Brief = {
  sections: BriefSection[];
  citations: Citation[];
};

export type AgentStatus = 'pending' | 'running' | 'done' | 'error';

export type Position = {
  conditionId: string;
  market: string;
  asset: string;
  outcomeIndex: number;
  size: number;
  avgPrice: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  curPrice: number;
  title: string;
  outcome: string;
  endDate?: string | null;
};

export type WatchItem = {
  marketId: string;
  title: string;
  price: number;
  delta: string;
};

export type ProviderName =
  | 'anthropic'
  | 'anthropic-cc'
  | 'openai'
  | 'google'
  | 'perplexity'
  | 'xai';

export type KOLSentimentItem = {
  id: string;
  kol: string;
  handle: string;
  excerpt: string;
  when: string;
  relevance: number;
  url: string;
};

export type NewsItem = {
  id: string;
  title: string;
  src: string;
  when: string;
  url?: string;
  /** True when the source isn't on the curated allowlist for this market —
   *  shown but flagged so the trader can apply their own discount. */
  unverified?: boolean;
};

export type BookRow = {
  id: string;
  side: 'YES' | 'NO';
  price: number;
  size: number;
  cum: number;
};

export type HolderRow = {
  id: string;
  rank: number;
  address: string;
  side: 'YES' | 'NO';
  size: number;
  pctYes: number | null;
};

export type ThesisNode = {
  kind: 'supports' | 'challenges';
  label: string;
  citationId?: string;
};

export type Thesis = {
  rootLabel: string;
  nodes: ThesisNode[];
};

/** A resolved-market comparable used by the Thesis panel as a base-rate anchor. */
export type ComparableHit = {
  eventId: string;
  title: string;
  endDate: string | null;
  outcome: 'yes' | 'no' | 'unresolved';
  resolvedPrice: number | null;
  slug?: string;
  score: number;
};

export type VerdictSection = {
  label: string;
  value: string;
};

export type ChatMessage = {
  role: 'user' | 'ai';
  content: string;
  citations?: string[];
};

// ----------------------------------------------------------------------------
// Hook-layer additions (do not remove existing types above — components depend
// on them). The shapes below match what the hooks/lib layer returns.
// ----------------------------------------------------------------------------

/** A single claim line inside a brief section. */
export type BriefClaim = {
  text: string;
  citations: string[];
};

/** Brief section reshaped from the SSE agent stream. */
export type BriefShapeSection = {
  id: string;
  title: string;
  claims: BriefClaim[];
};

/** Per-agent status in the supervisor pipeline. Keys mirror AgentId on server
 *  plus a few UI-only slots ('sentiment', 'thesis', 'ask') that may stay
 *  'pending' if the server doesn't emit for them. */
export type BriefAgents = {
  market: AgentStatus;
  holders: AgentStatus;
  news: AgentStatus;
  sentiment: AgentStatus;
  thesis: AgentStatus;
  synthesis: AgentStatus;
  ask: AgentStatus;
};

/** Detail captured per agent for tooltip surfacing — error text + elapsed ms.
 *  Same key set as BriefAgents; missing entries mean the agent never reported. */
export type BriefAgentDetail = {
  error?: string;
  elapsedMs?: number;
};
export type BriefAgentDetails = Partial<Record<keyof BriefAgents, BriefAgentDetail>>;

/** Reduced shape of the live brief stream consumed by UI panels. */
export type BriefShape = {
  market: Market | null;
  /** Raw MarketMeta envelope from the supervisor (`{marketId, tokenIdYes,
   *  tokenIdNo, ...}`). Needed verbatim by /api/ask which validates against
   *  MarketMeta before grounding. */
  rawMarket: unknown;
  agents: BriefAgents;
  /** Per-agent error/elapsed detail for tooltip surfacing. */
  agentDetails: BriefAgentDetails;
  sections: BriefShapeSection[];
  citations: Citation[];
  /** Book panel rows derived from the supervisor's `agent:data` grounding. */
  bookRows: BookRow[];
  /** Holders panel rows derived from grounding. */
  holderRows: HolderRow[];
  /** News panel catalysts derived from grounding (preserves headlines + URLs
   *  the citation list otherwise loses). */
  newsItems: NewsItem[];
  errors: string[];
  complete: boolean;
};

/** Provider config exposed by useProvider. Plaintext keys are intentionally
 *  NOT in this object — call getKeys() for them. */
export type ProviderConfig = {
  primary: ProviderName | null;
  hasPrimaryKey: boolean;
  hasPerplexity: boolean;
  hasXai: boolean;
};

/** Slots used by useProvider / cryptoStorage for BYOK key-at-rest. */
export type ProviderSlot = 'primary' | 'perplexity' | 'xai';
