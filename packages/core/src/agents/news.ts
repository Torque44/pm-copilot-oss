// NewsAgent — gathers catalysts in the next 72h via the LLM provider
// (web-search capable providers handle this natively; others fall back to
// "no catalysts identified").
//
// First, it checks the registry for any user-supplied feed that serves the
// "news" scope on the active venue (e.g. an X-actions MCP server, Adjacent
// News MCP). If a feed is registered, it overrides the LLM-driven path.

import { feed as feedFor } from '../mcp/registry';
import { getProvider } from '../providers/index';
import { extractJson, type LLMProvider } from '../providers/types';
import type {
  AgentContext,
  AgentResult,
  Citation,
  Claim,
  NewsGrounding,
  NewsItem,
  SectionOut,
} from './types';

const SYS = `You are a prediction-market catalyst scanner. Given the title of a live binary market, use web search to find:

- Hard scheduled catalysts in the next 72h (games, press events, releases, votes, etc.)
- Material news from the last 48h that affects the market's outcome
- Any recent sharp line movement or coverage

Return JSON with this exact shape:
{
  "items": [
    { "headline": "<short>", "source": "<publication/site>", "url": "<full url>", "publishedAt": "<ISO date if known>", "snippet": "<1–2 sentences>" }
  ],
  "claims": [
    { "text": "<one-sentence catalyst/news claim referencing [news·N]>", "citations": ["news·1"] }
  ]
}

Rules:
- items[] should have 2–4 entries, with real URLs you found via web search.
- claims[] should have 2–3 entries, each citing at least one [news·N] (N = 1-indexed rank in items[]).
- If you cannot find any meaningful catalysts, return one claim: "No material catalysts identified in the last 48 hours." with citations: [].
- Do not fabricate URLs. If web search failed, return items: [] and a single "no catalyst" claim.`;

type NewsResp = {
  items?: NewsItem[];
  claims?: Claim[];
};

async function fromUserFeed(
  ctx: AgentContext
): Promise<NewsGrounding | null> {
  const venue = ctx.market.venue ?? 'polymarket';
  const userFeed = feedFor(venue, 'news');
  if (!userFeed?.getNews) return null;
  // Skip the built-in (which intentionally returns null for news) and only use
  // user-registered MCP feeds for this scope.
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
): Promise<AgentResult> {
  const started = Date.now();
  const { market, emit } = ctx;

  // 1) Prefer a user-registered news MCP if available.
  const fromFeed = await fromUserFeed(ctx);
  if (fromFeed) {
    emit({ t: 'agent:data', agent: 'news', grounding: fromFeed });
    const items = fromFeed.items.slice(0, 4);
    const citations: Citation[] = items.map((it, i) => ({
      id: `news·${i + 1}`,
      kind: 'news',
      // Use the article headline as the human-facing label (truncated). The
      // numeric rank lives in the id; consumers that want the rank can read
      // it from id.
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

  // 2) Provider-driven web search path. Only providers whose capability flag
  //    advertises web search will get a useful result here; others gracefully
  //    return "no catalysts."
  const newsProvider = provider ?? getProvider();
  const allowedTools = newsProvider.capabilities.webSearch ? ['WebSearch'] : [];

  const prompt = `Market title: "${market.title}"
Market ends: ${market.endDate ?? 'unknown'}
Current YES price: ${market.yes != null ? (market.yes * 100).toFixed(1) + '¢' : 'n/a'}

Search the web for news and scheduled catalysts relevant to this market. Prioritize items from the last 48 hours and scheduled events in the next 72 hours. Return the JSON as specified.`;

  const res = await newsProvider.complete(prompt, {
    tier: 'fast',
    systemPrompt: SYS,
    allowedTools,
    jsonOnly: true,
    timeoutMs: 120_000,
  });

  const parsed = res.ok ? extractJson<NewsResp>(res.text) : null;
  const items: NewsItem[] = Array.isArray(parsed?.items) ? parsed!.items.slice(0, 4) : [];
  const rawClaims: Claim[] = Array.isArray(parsed?.claims) ? parsed!.claims : [];

  const grounding: NewsGrounding = { kind: 'news', items };
  emit({ t: 'agent:data', agent: 'news', grounding });

  const citations: Citation[] = items.map((it, i) => ({
    id: `news·${i + 1}`,
    kind: 'news' as const,
    label: (it.headline || `news·${i + 1}`).slice(0, 80),
    payload: it,
    url: it.url,
  }));

  const validIds = new Set(citations.map(c => c.id));

  let claims: Claim[] = rawClaims.map(c => {
    const ids = Array.isArray(c.citations) ? c.citations : [];
    const remapped = ids
      .map(id => {
        const cleaned = String(id).replace(/[\[\]]/g, '').trim();
        return validIds.has(cleaned) ? cleaned : null;
      })
      .filter((x): x is string => x != null);
    return {
      text: String(c.text ?? '').trim(),
      citations: remapped,
    };
  }).filter(c => c.text.length > 0).slice(0, 3);

  if (!claims.length && items.length) {
    claims = items.slice(0, 3).map((it, i) => ({
      text: `${it.headline} (${it.source}).`,
      citations: [`news·${i + 1}`],
    }));
  }

  if (!claims.length) {
    claims = [{
      text: 'No material catalysts identified in the last 48 hours or scheduled in the next 72.',
      citations: [],
    }];
  }

  const output: SectionOut = { claims, citations };

  return {
    agent: 'news',
    output,
    grounding,
    elapsedMs: Date.now() - started,
    ...(res.ok ? {} : { error: res.error }),
  };
}
