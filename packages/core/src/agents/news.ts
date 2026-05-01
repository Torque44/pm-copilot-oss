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
import {
  classifyMarket,
  isAllowlisted,
  isDenylisted,
  profileFor,
} from '../sources/registry';
import type {
  AgentContext,
  AgentResult,
  Citation,
  Claim,
  NewsGrounding,
  NewsItem,
  SectionOut,
} from './types';

function buildSystemPrompt(allowedDomains: string[], hint: string): string {
  return `You are a research analyst building a fast briefing for a prediction-market trader. The trader needs context: what's the question really about, what's happened recently, and what's coming up that could move the market.

Source rules — follow STRICTLY:
- ONLY cite items from these vetted domains: ${allowedDomains.slice(0, 30).join(', ')}${allowedDomains.length > 30 ? `, ${allowedDomains.length - 30} more` : ''}.
- NEVER cite Wikipedia, Wikipedia mirrors, Reddit, Substack, Medium, Forbes contributor pieces, Yahoo aggregator pages, or any user-editable source.
- ${hint}
- If web search returns content from a non-vetted source, drop it from the response. Do not paraphrase from it.
- If the topic is too niche for any vetted source, fall back to your training-data knowledge marked from:"training", relevance:"low" — but DO NOT invent URLs or sources.

Use web search aggressively across the vetted domains. Cast a wide net:

- Recent news (last 30 days) about the entities/event in the title
- Scheduled events that could drive resolution (votes, releases, summits, games, earnings, court dates)
- Background context: what is this dispute/question about, who are the parties, what's the current state
- If the topic is too niche or breaking for web search, fall back to your training-data knowledge — mark such items with "from": "training" and a confidence flag

Return JSON ONLY (no markdown fences, no prose) with this exact shape:
{
  "background": "<1–2 sentences explaining what this market is really asking about>",
  "items": [
    {
      "headline": "<short, neutral>",
      "source": "<publication or domain>",
      "url": "<full url; '' if from training>",
      "publishedAt": "<ISO date if known, else ''>",
      "snippet": "<1–2 sentences why this matters to the market>",
      "relevance": "high" | "med" | "low",
      "from": "web" | "training"
    }
  ],
  "claims": [
    { "text": "<concise observation citing [news·N]>", "citations": ["news·1"] }
  ]
}

Rules:
- items[] target 5–8 entries. Mix of recent news + scheduled events + background.
- Always emit at least one item even on niche topics — fall back to training-data with from:"training", relevance:"low" if web search returns nothing.
- claims[] target 3–4 entries. Each must cite [news·N] referencing items[N-1].
- Do not fabricate URLs. If unsure, leave url:"".
- Be neutral; let the trader form their own view.`;
}

type NewsResp = {
  items?: NewsItem[];
  claims?: Claim[];
  background?: string;
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

  // Route by market sub-category to the curated source profile so the model
  // only cites trader-grade outlets (no Wikipedia / Reddit / open posting
  // platforms — see sources/registry).
  const sub = classifyMarket(market.category ?? '', market.title);
  const profile = profileFor(sub);
  const systemPrompt = buildSystemPrompt(profile.domains, profile.hint);

  const prompt = `Market title: "${market.title}"
Resolves by: ${market.endDate ?? 'unknown'}
Current YES price: ${market.yes != null ? (market.yes * 100).toFixed(1) + '¢' : 'n/a'}

Build a fast briefing for a trader looking at this contract.
Cast a wide net: last 30 days of news + scheduled events + background context.
If the topic is niche/breaking and web search comes up thin, supplement from
your training-data knowledge marked from:"training". Return the JSON shape
specified in the system prompt.`;

  const res = await newsProvider.complete(prompt, {
    tier: 'fast',
    systemPrompt,
    allowedTools,
    jsonOnly: true,
    // News with WebSearch can take >60s — give it room.
    timeoutMs: 180_000,
  });

  const parsed = res.ok ? extractJson<NewsResp>(res.text) : null;
  const rawItems: NewsItem[] = Array.isArray(parsed?.items) ? parsed!.items : [];
  // Source filtering:
  //   - drop denylisted domains silently (Wikipedia / Reddit / Substack / Medium / Forbes / Yahoo)
  //   - flag items that survive the denylist but aren't on the curated allowlist
  //     for this sub-category as `unverified` so the UI can mark them
  //   - training-data items (no URL) pass through with no filtering — the
  //     prompt already tells the model to mark them low-relevance
  const items: NewsItem[] = rawItems
    .filter(it => {
      if (it.from === 'training' || !it.url) return true;
      return !isDenylisted(it.url);
    })
    .map(it => {
      if (it.from === 'training' || !it.url) return it;
      const verified = isAllowlisted(sub, it.url);
      return verified ? it : { ...it, unverified: true };
    })
    .slice(0, 8);
  const rawClaims: Claim[] = Array.isArray(parsed?.claims) ? parsed!.claims : [];
  const background = typeof parsed?.background === 'string' ? parsed!.background : '';

  // Debug visibility: when we fail to extract anything useful, log the raw
  // text so we can tell whether the model declined, hit a rate limit, or
  // simply returned `{items:[],claims:[]}` after a real (empty) web search.
  if (items.length === 0 && rawClaims.length === 0) {
    const sample = (res.text || '').replace(/\s+/g, ' ').slice(0, 400);
    console.warn(
      `[news] empty result for "${market.title}" (${res.ok ? 'ok' : 'err: ' + res.error}): ${sample}`,
    );
  }

  const grounding: NewsGrounding = background
    ? { kind: 'news', items, background }
    : { kind: 'news', items };
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
    // Differentiate the empty fallback by root cause so the UI can show
    // something useful instead of an opaque "no catalysts" message.
    const errMsg = res.error || '';
    const isAuth = /claude-code|Not logged in|Please run \/login|API key|credit balance/i.test(errMsg);
    claims = [{
      text: isAuth
        ? `news agent failed: provider authentication. ${errMsg.slice(0, 160)}`
        : !res.ok
          ? `news agent failed: ${errMsg.slice(0, 160) || 'provider error'}`
          : 'no recent catalysts surfaced for this market — the underlying topic may be too niche or breaking for web search to anchor.',
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
