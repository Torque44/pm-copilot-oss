// NewsAgent — thin orchestrator over the news/ self-healing search chain.
//
// Flow:
//   1. If a user-registered MCP feed serves news for this venue, use it.
//   2. Otherwise, delegate to news/searchChain — 3 backends × 3 query
//      variants × retry policy × 6h LRU cache.
//
// The whole "ask the model to do web search and pray it doesn't fabricate"
// path is dead. Real tools produce evidence; this agent only renders it
// into citations + claims. The diagnostic empty-state claim is the only
// thing it generates on its own.

import { feed as feedFor } from '../mcp/registry';
import { isAllowlisted, isDenylisted, classifyMarket } from '../sources/registry';
import type { LLMProvider } from '../providers/types';
import type { Searcher } from '../providers/exa';
import { searchNews } from '../news/searchChain';
import { makeExaBackend } from '../news/backends/exa';
import { makePolymarketCommentsBackend } from '../news/backends/polymarketComments';
import { makeProviderWebSearchBackend } from '../news/backends/providerWebSearch';
import { NewsCache } from '../news/cache';
import type {
  AgentContext,
  AgentResult,
  Citation,
  Claim,
  NewsGrounding,
  NewsItem,
} from './types';

export type NewsOpts = {
  /** When set, news searches the `days`-day window ending at `endsAt` rather
   *  than "the last 30 days from today." The supervisor passes this for
   *  resolved markets — the trader cares about the leadup to resolution,
   *  not "right now." */
  windowOverride?: { endsAt: string; days: number };
  /** Process-singleton cache injected by the server. When omitted (tests
   *  without a cache), an ephemeral cache is created per-call. */
  cache?: NewsCache;
};

async function fromUserFeed(ctx: AgentContext): Promise<NewsGrounding | null> {
  const venue = ctx.market.venue ?? 'polymarket';
  const userFeed = feedFor(venue, 'news');
  if (!userFeed?.getNews) return null;
  // Skip the built-in (which intentionally returns null for news) and only
  // use user-registered MCP feeds for this scope.
  if (userFeed.descriptor.source !== 'mcp') return null;
  try {
    return await userFeed.getNews(ctx.market);
  } catch {
    return null;
  }
}

export async function runNewsAgent(
  ctx: AgentContext,
  provider?: LLMProvider,
  searcher?: Searcher | null,
  opts?: NewsOpts,
): Promise<AgentResult> {
  const started = Date.now();
  const { market, emit } = ctx;

  // 1) MCP user-feed override (X-actions, Adjacent News, etc).
  const fromFeed = await fromUserFeed(ctx);
  if (fromFeed) {
    emit({ t: 'agent:data', agent: 'news', grounding: fromFeed });
    const items = fromFeed.items.slice(0, 4);
    const citations: Citation[] = items.map((it, i) => ({
      id: `news·${i + 1}`,
      kind: 'news',
      label: (it.headline || `news·${i + 1}`).slice(0, 80),
      payload: it,
      url: it.url,
    }));
    const claims: Claim[] = items.length
      ? items.slice(0, 3).map((it, i) => ({
          text: `${it.headline} (${it.source}).`,
          citations: [`news·${i + 1}`],
        }))
      : [{ text: 'No material catalysts surfaced.', citations: [] }];
    return {
      agent: 'news',
      output: { claims, citations },
      grounding: fromFeed,
      elapsedMs: Date.now() - started,
    };
  }

  // 2) Compute search window (today's 30d for active, override for resolved).
  const windowEnd = opts?.windowOverride
    ? opts.windowOverride.endsAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const windowStartMs = opts?.windowOverride
    ? Date.parse(opts.windowOverride.endsAt) - opts.windowOverride.days * 24 * 60 * 60 * 1000
    : Date.now() - 30 * 24 * 60 * 60 * 1000;
  const windowStart = new Date(windowStartMs).toISOString().slice(0, 10);

  // 3) Build the backend chain. Each backend's available() decides whether
  //    it can run in this environment. Order matters: cheapest/fastest first.
  const newsProvider = provider ?? null;
  const cache = opts?.cache ?? new NewsCache();
  const backends = [
    makeExaBackend(searcher ?? null),
    makePolymarketCommentsBackend({ slugFor: () => market.slug || null }),
    makeProviderWebSearchBackend(() => newsProvider),
  ];

  // 4) Run the chain. Returns NewsHit[] (cleaned, deduped, dated).
  const hits = await searchNews(
    { marketId: market.marketId, title: market.title, slug: market.slug },
    backends,
    cache,
    { windowStart, windowEnd, marketTitle: market.title },
  );

  // 5) Render to NewsItem[], tag unverified for off-curated-allowlist
  //    sources, sort newest-first, drop denylisted (chain already does
  //    but defensive).
  const sub = classifyMarket(market.category ?? '', market.title);
  const items: NewsItem[] = hits.map((h) => {
    const item: NewsItem = {
      headline: h.title,
      source: h.source,
      url: h.url,
      publishedAt: h.publishedAt,
      snippet: h.snippet,
      relevance: h.score != null && h.score > 0.7 ? 'high'
        : h.score != null && h.score > 0.4 ? 'med' : 'low',
      from: 'web',
    };
    if (!isAllowlisted(sub, h.url)) item.unverified = true;
    return item;
  });

  items.sort((a, b) => Date.parse(b.publishedAt ?? '0') - Date.parse(a.publishedAt ?? '0'));
  const cleanItems = items.filter((it) => it.url && !isDenylisted(it.url));

  const grounding: NewsGrounding = { kind: 'news', items: cleanItems };
  emit({ t: 'agent:data', agent: 'news', grounding });

  const citations: Citation[] = cleanItems.map((it, i) => ({
    id: `news·${i + 1}`,
    kind: 'news' as const,
    label: (it.headline || `news·${i + 1}`).slice(0, 80),
    payload: it,
    url: it.url,
  }));

  // 6) Build claims. Top items → one-liner each; empty → single diagnostic.
  const claims: Claim[] = cleanItems.length
    ? cleanItems.slice(0, 3).map((it, i) => ({
        text: `${it.headline} (${it.source}).`,
        citations: [`news·${i + 1}`],
      }))
    : [{
        text: emptyStateClaim({
          anyBackendAvailable: backends.some((b) => b.available()),
        }),
        citations: [],
      }];

  if (cleanItems.length === 0) {
    console.warn(`[news] empty result for market=${market.marketId} backends=${backends.filter((b) => b.available()).map((b) => b.name).join(',') || 'none'}`);
  }

  return {
    agent: 'news',
    output: { claims, citations },
    grounding,
    elapsedMs: Date.now() - started,
  };
}

function emptyStateClaim(state: { anyBackendAvailable: boolean }): string {
  if (!state.anyBackendAvailable) {
    return 'no live news backend configured — server needs EXA_API_KEY or a web-search-capable provider. The catalysts panel can\'t surface news without one.';
  }
  return 'no recent news surfaced for this market from any of 3 backends (Exa, polymarket comments, provider web search). The topic may be niche or too breaking for our sources.';
}
