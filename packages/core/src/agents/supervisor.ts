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
import { runMarketAgent } from './market';
import { runHoldersAgent } from './holders';
import { runNewsAgent } from './news';
import { runSynthesis } from './synthesis';
import { runSentimentAgent, type SentimentInput } from './sentiment';
import { runThesisAgent, type ThesisInput } from './thesis';

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
};

export async function runSupervisor(opts: SupervisorOpts): Promise<void> {
  const { market, emit, rememberGrounding, routing, tweets } = opts;

  const sentimentEnabled = Boolean(routing?.sentiment);

  // Emit start for the agents the UI should render as pending. Sentiment only
  // appears when xAI is configured; thesis always appears (runs on primary).
  const startedAgents: AgentId[] = ['market', 'holders', 'news', 'thesis', 'synthesis'];
  if (sentimentEnabled) startedAgents.splice(3, 0, 'sentiment');
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
    yesPrice: typeof market.yes === 'number' ? market.yes : null,
    noPrice: typeof market.no === 'number' ? market.no : null,
    endDate: typeof market.endDate === 'string' ? market.endDate : null,
    tweets: tweets ?? [],
  };

  // Per HANDOFF.md §Task C: News uses routing.news (Perplexity if configured,
  // else primary). Market, Holders, Synthesis all use routing.primary.
  const primaryProvider = routing?.primary;
  const newsProvider = routing?.news ?? routing?.primary;

  const fanOut: Array<Promise<AgentResult>> = [
    runOne('market', (c) => runMarketAgent(c, primaryProvider)),
    runOne('holders', (c) => runHoldersAgent(c, primaryProvider)),
    runOne('news', (c) => runNewsAgent(c, newsProvider)),
  ];
  if (sentimentEnabled && routing) {
    fanOut.push(
      runOne('sentiment', () => runSentimentAgent(ctx, routing.sentiment, sentimentInput)),
    );
  }

  const results = await Promise.all(fanOut);
  const marketR = results[0]!;
  const holdersR = results[1]!;
  const newsR = results[2]!;
  const sentimentR = sentimentEnabled ? results[3] ?? null : null;

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
  // Receives the merged citation set from upstream so its sub-claims must
  // resolve to IDs in the supplied evidence (the agent enforces this).
  const upstreamCitations: Citation[] = [
    ...marketR.output.citations,
    ...holdersR.output.citations,
    ...newsR.output.citations,
    ...(sentimentR ? sentimentR.output.citations : []),
  ];

  const upstreamSummary = [
    ...marketR.output.claims,
    ...holdersR.output.claims,
    ...newsR.output.claims,
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
  const thesisR = await runOne('thesis', () =>
    runThesisAgent(ctx, thesisProvider, thesisInput),
  );

  // ---- Synthesis ----
  const synthStart = Date.now();
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

  // Thesis result is emitted via runOne above; nothing else to do.
  void thesisR;
}
