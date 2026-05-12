// Supervisor — orchestrates Market, Holders, News agents in parallel, then
// Sentiment (if xAI configured) and Thesis (after specialists), then Synthesis.
// Emits AgentEvents via the provided emit function (typically wired to SSE).
//
// The server passes in a `rememberGrounding` callback so the supervisor doesn't
// reach into server state — keeps core/* free of cross-package coupling.
//
// Per HANDOFF.md §Task C:
//   1. runSentimentAgent runs in parallel with the specialists IF
//      routing.sentiment is non-null (xAI configured).
//   2. runThesisAgent runs AFTER specialists, before synthesis. Receives the
//      merged citation set from upstream.
//   3. News uses routing.news (Perplexity if configured, else primary).
//      Everything else uses routing.primary.

import type {
  AgentContext,
  AgentEvent,
  AgentId,
  AgentResult,
  BookGrounding,
  Citation,
  HoldersGrounding,
  MarketMeta,
  NewsGrounding,
} from './types';
import type { LLMProvider } from '../providers/types';

/** Strip control bytes and obvious prompt-injection markers from untrusted
 *  text (market titles arrive verbatim from Polymarket Gamma — not attacker-
 *  controlled today, but cheap to defend). Caps length to 280 chars so an
 *  oversized title can't blow out the system prompt budget. */
function sanitizeUntrustedText(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)\b/gi, '[redacted]')
    .replace(/\bsystem\s+prompt\b/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}
import { runMarketAgent } from './market';
import { runHoldersAgent } from './holders';
import { runNewsAgent } from './news';
import { runSynthesis } from './synthesis';
import { runSentimentAgent, type SentimentInput } from './sentiment';
import { runThesisAgent, type ThesisInput } from './thesis';
import { runComparablesAgent, type ComparablesInput } from './comparables';
import type { Searcher } from '../providers/exa';

export type RememberGrounding = {
  (marketId: string, kind: 'book', data: BookGrounding | null): void;
  (marketId: string, kind: 'holders', data: HoldersGrounding | null): void;
  (marketId: string, kind: 'news', data: NewsGrounding | null): void;
};

/**
 * Per-agent provider routing. Built by `byokProvider()` from the request's
 * BYOK headers (or env-var fallbacks). Always passed to runSupervisor when the
 * server wants distinct providers per agent. If omitted, supervisor falls back
 * to `getProvider()` (primary only) and skips sentiment.
 */
export type AgentRouting = {
  primary: LLMProvider;
  news: LLMProvider;
  sentiment: LLMProvider | null;
};

export type SupervisorOpts = {
  market: MarketMeta;
  emit: (ev: AgentEvent) => void;
  /** Optional grounding cache hook. Server wires this to its in-memory store. */
  rememberGrounding?: RememberGrounding;
  /** Optional per-agent routing. When omitted, agents use the global default
   *  provider via getProvider() and sentiment is skipped. */
  routing?: AgentRouting;
  /** Optional list of recent KOL tweets for the sentiment pass. The server
   *  populates this from an X-actions MCP feed when registered; when empty the
   *  sentiment agent emits a "no recent X mentions" claim. */
  tweets?: SentimentInput['tweets'];
  /** Optional web-search backend (Exa). When the news provider doesn't have
   *  native web search (Perplexity does, OpenAI/Claude don't via Chat API),
   *  the news agent uses this searcher to fetch real hits, then asks the
   *  provider to synthesise. Silent default for the public demo. */
  searcher?: Searcher | null;
  /** Optional abort signal. The server wires this from req.on('close') so
   *  a client disconnect short-circuits the supervisor at wave boundaries
   *  — no more burning BYOK / OpenAI quota on an answer no one is reading.
   *  Wave-1 specialists already in flight finish (their fetches are short),
   *  but wave-2 thesis + synthesis don't fire if the signal is aborted. */
  signal?: AbortSignal;
};

export async function runSupervisor(opts: SupervisorOpts): Promise<void> {
  const { market: rawMarket, emit, rememberGrounding, routing, tweets, searcher, signal } = opts;

  // Sanitize the title once and pass the cleaned market to every downstream
  // agent. Other fields (numeric prices, ISO dates, marketId) don't need
  // sanitization — they go through narrow parsers.
  const market: MarketMeta = {
    ...rawMarket,
    title: sanitizeUntrustedText(rawMarket.title || ''),
  };

  const sentimentEnabled = Boolean(routing?.sentiment);

  // Resolved markets short-circuit sentiment + thesis. Both agents produce
  // their worst hallucinations when there's no real-time data to ground in
  // (the market already paid out — there IS no "current X conversation" or
  // "what could move it"). News still runs but against the resolution
  // leadup window (Task 4 windowOverride). Synthesis still runs and is
  // told via prompt this is a resolved-market brief.
  const isResolved = Boolean(market.resolvedAt);

  // Emit start for the agents the UI should render as pending. Sentiment only
  // appears when xAI is configured AND the market isn't resolved. Thesis
  // appears for active markets only.
  const startedAgents: AgentId[] = isResolved
    ? ['market', 'holders', 'news', 'comparables', 'synthesis']
    : ['market', 'holders', 'news', 'comparables', 'thesis', 'synthesis'];
  if (sentimentEnabled && !isResolved) startedAgents.splice(3, 0, 'sentiment');
  for (const a of startedAgents) emit({ t: 'agent:start', agent: a });

  const ctx: AgentContext = { market, emit };

  // Wrap each specialist so we always emit agent:done (or error), never crash the SSE.
  const runOne = async (
    id: AgentId,
    fn: (c: AgentContext) => Promise<AgentResult>,
  ): Promise<AgentResult> => {
    const started = Date.now();
    try {
      const r = await fn(ctx);
      if (r.error) {
        emit({ t: 'agent:error', agent: id, error: r.error, elapsedMs: r.elapsedMs });
      } else {
        emit({ t: 'agent:done', agent: id, elapsedMs: r.elapsedMs, output: r.output });
      }
      return r;
    } catch (err: unknown) {
      const elapsedMs = Date.now() - started;
      const msg = err instanceof Error ? err.message : 'unknown error';
      emit({ t: 'agent:error', agent: id, error: msg, elapsedMs });
      return {
        agent: id,
        output: {
          claims: [{ text: `${id} agent failed: ${msg}`, citations: [] }],
          citations: [],
        },
        grounding: null,
        elapsedMs,
        error: msg,
      };
    }
  };

  // Sentiment runs in parallel with the 3 specialists when xAI is configured.
  // We intentionally launch all 4 fans-out together so the dot animation feels
  // simultaneous, and the slow specialists (web-search news) don't gate it.
  const sentimentInput: SentimentInput = {
    marketTitle: market.title,
    category: market.category,
    yesPrice: typeof market.yes === 'number' ? market.yes : null,
    noPrice: typeof market.no === 'number' ? market.no : null,
    endDate: typeof market.endDate === 'string' ? market.endDate : null,
    tweets: tweets ?? [],
  };

  // Per HANDOFF.md §Task C: News uses routing.news (Perplexity if configured,
  // else primary). Market, Holders, Synthesis all use routing.primary.
  const primaryProvider = routing?.primary;
  const newsProvider = routing?.news ?? routing?.primary;

  const comparablesInput: ComparablesInput = {
    marketTitle: market.title,
    category: market.category,
  };

  const fanOut: Array<Promise<AgentResult>> = [
    runOne('market', (c) => runMarketAgent(c, primaryProvider)),
    runOne('holders', (c) => runHoldersAgent(c, primaryProvider)),
    runOne('news', (c) => runNewsAgent(c, newsProvider, searcher)),
    // Comparables is deterministic (HTTP only, no LLM) — fans out with the
    // specialists so its result is ready when thesis runs.
    runOne('comparables', () => runComparablesAgent(ctx, comparablesInput)),
  ];
  if (sentimentEnabled && routing && !isResolved) {
    fanOut.push(
      runOne('sentiment', () => runSentimentAgent(ctx, routing.sentiment, sentimentInput)),
    );
  }

  const results = await Promise.all(fanOut);
  if (signal?.aborted) {
    // Client disconnected during wave-1. Don't spend the wave-2 LLM budget
    // (thesis + synthesis are the most expensive calls of the pipeline).
    return;
  }
  // fanOut order: market, holders, news, comparables, [sentiment]
  // Sentiment only appears when sentimentEnabled AND !isResolved (see fanOut
  // assembly above).
  const marketR = results[0]!;
  const holdersR = results[1]!;
  const newsR = results[2]!;
  const comparablesR = results[3]!;
  const sentimentR = sentimentEnabled && !isResolved ? results[4] ?? null : null;

  // Stash the raw grounding per-market so /api/ask can reuse it. The cast is
  // safe because each agent only ever returns its own grounding kind.
  if (rememberGrounding) {
    rememberGrounding(
      market.marketId,
      'book',
      marketR.grounding && marketR.grounding.kind === 'book' ? marketR.grounding : null,
    );
    rememberGrounding(
      market.marketId,
      'holders',
      holdersR.grounding && holdersR.grounding.kind === 'holders' ? holdersR.grounding : null,
    );
    rememberGrounding(
      market.marketId,
      'news',
      newsR.grounding && newsR.grounding.kind === 'news' ? newsR.grounding : null,
    );
  }

  // ---- Thesis: runs after specialists, before synthesis. ----
  // Receives the merged citation set from upstream (book/whale/news/kol/comp)
  // so its sub-claims must resolve to IDs in the supplied evidence.
  const upstreamCitations: Citation[] = [
    ...marketR.output.citations,
    ...holdersR.output.citations,
    ...newsR.output.citations,
    ...comparablesR.output.citations,
    ...(sentimentR ? sentimentR.output.citations : []),
  ];

  const upstreamSummary = [
    ...marketR.output.claims,
    ...holdersR.output.claims,
    ...newsR.output.claims,
    ...comparablesR.output.claims,
    ...(sentimentR ? sentimentR.output.claims : []),
  ]
    .map((c) => c.text)
    .filter(Boolean)
    .join(' · ');

  const thesisInput: ThesisInput = {
    marketTitle: market.title,
    yesPrice: typeof market.yes === 'number' ? market.yes : null,
    evidenceCitations: upstreamCitations,
    evidenceClaimSummary: upstreamSummary,
  };
  const thesisProvider = routing?.primary ?? null;

  // ---- Wave 2: thesis + synthesis run in parallel ----
  // Synthesis only consumes market/holders/news section outputs from Wave 1
  // (see runSynthesis call below — no thesis input). Thesis only consumes the
  // merged Wave 1 citations. Neither depends on the other, so we fan them out
  // together and shave ~5s off the cold-load wall-clock.
  const synthStart = Date.now();
  // Thesis is forward-looking ("what could move it") — meaningless for a
  // settled market. Skip entirely when resolved; the agent isn't in
  // startedAgents either, so the UI never shows a dot for it.
  const thesisP: Promise<AgentResult | null> = isResolved
    ? Promise.resolve(null)
    : runOne('thesis', () => runThesisAgent(ctx, thesisProvider, thesisInput));
  const synthesisP = (async () => {
    try {
      const synth = await runSynthesis(
        {
          market,
          market_section: marketR.output,
          holders_section: holdersR.output,
          news_section: newsR.output,
        },
        ctx,
        primaryProvider,
      );
      emit({
        t: 'agent:done',
        agent: 'synthesis',
        elapsedMs: synth.elapsedMs,
        output: synth.output,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'synthesis failed';
      emit({
        t: 'agent:error',
        agent: 'synthesis',
        error: msg,
        elapsedMs: Date.now() - synthStart,
      });
      emit({ t: 'error', error: msg });
    }
  })();
  const [thesisR] = await Promise.all([thesisP, synthesisP]);

  // Thesis result is emitted via runOne above; nothing else to do.
  void thesisR;
}
