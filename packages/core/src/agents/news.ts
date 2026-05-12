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
import type { Searcher, SearchHit } from '../providers/exa';
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

/** Bucket a provider error into a short categorical hint for logging.
 *  Avoids leaking raw model text or vendor message strings into server logs. */
function errorClass(raw: string | undefined): string {
  if (!raw) return 'unknown';
  if (/401|403|unauthor|invalid.*key/i.test(raw)) return 'auth';
  if (/timeout|aborted/i.test(raw)) return 'timeout';
  if (/429|rate.*limit|quota/i.test(raw)) return 'rate-limit';
  if (/credit balance|insufficient/i.test(raw)) return 'credit';
  if (/claude-code|Not logged in|Please run/i.test(raw)) return 'cc-not-signed-in';
  return 'provider-error';
}

function buildSystemPrompt(allowedDomains: string[], hint: string): string {
  return `You are a research analyst building a fast briefing for a prediction-market trader. The trader needs context: what's the question really about, what's happened recently, and what's coming up that could move the market.

Source rules — follow STRICTLY:
- ONLY cite items from these vetted domains: ${allowedDomains.slice(0, 30).join(', ')}${allowedDomains.length > 30 ? `, ${allowedDomains.length - 30} more` : ''}.
- NEVER cite Wikipedia, Wikipedia mirrors, Reddit, Substack, Medium, Forbes contributor pieces, Yahoo aggregator pages, or any user-editable source.
- ${hint}
- If web search returns content from a non-vetted source, drop it from the response. Do not paraphrase from it.

HARD RULE — NO HALLUCINATIONS, EVER:
- This is a LIVE prediction-market product. Users rely on the news section
  to make trading decisions. A fabricated headline can cost real money.
- DO NOT EVER fall back to training-data knowledge to fill the items array.
- DO NOT invent a source name (e.g., "reuters.com", "nytimes.com") for an
  item you didn't actually retrieve from web search.
- DO NOT invent a publishedAt date for an item that didn't have one.
- DO NOT invent URLs.
- If web search returns nothing relevant from the vetted domains, return
  items: [] — an EMPTY ARRAY. The UI will show "no recent news surfaced".
  Empty is the correct, honest answer when there is no news. The product
  prefers no answer over a wrong one.
- The ONLY items[] entries permitted are ones that come from a real web
  search hit on a vetted domain, with the real URL, headline, source
  domain, and publishedAt taken verbatim from the search result.

RECENCY RULES — this is a LIVE prediction market and stale news is the
single biggest UX failure mode of this product:
- STRONGLY PREFER items published in the last 7 DAYS from today's date
  (today's date is provided in the user prompt; use it).
- Expand to last 30 DAYS only if there is no relevant 7-day coverage.
- NEVER include news older than 6 MONTHS for an active market that
  resolves in the future — the trader needs the current state, not
  history. Anything older than 6 months belongs in "background context"
  not "items".
- Sort items[] DESCENDING by publishedAt — most recent first.
- If web search returns only stale items, prefer fewer fresh items over
  many stale ones. Returning 2 items from this week beats 8 items from
  last year.

Use web search aggressively across the vetted domains. Cast a wide net:

- Recent news (LAST 7 DAYS PREFERRED, last 30 days max) about the entities/event in the title
- Scheduled events that could drive resolution (votes, releases, summits, games, earnings, court dates)
- Background context: what is this dispute/question about, who are the parties, what's the current state
- If web search returns nothing for the specific market: TRY AGAIN with broader query terms (drop date qualifiers, broaden entity from "Musk tweet count" to "Elon Musk", search just the noun like "tweets" or "weather"). Do TWO total search passes before giving up.
- If both passes return nothing relevant: return items:[] EMPTY. Do not fill it with training-data items.

Return JSON ONLY (no markdown fences, no prose) with this exact shape:
{
  "background": "<1–2 sentences explaining what this market is really asking about>",
  "items": [
    {
      "headline": "<short, neutral>",
      "source": "<publication or domain>",
      "url": "<full url from the web-search result — REQUIRED, no item without a URL>",
      "publishedAt": "<ISO date from the web-search result — REQUIRED>",
      "snippet": "<1–2 sentences why this matters to the market>",
      "relevance": "high" | "med" | "low",
      "from": "web"
    }
  ],
  "claims": [
    { "text": "<concise observation citing [news·N]>", "citations": ["news·1"] }
  ]
}

Rules:
- items[] target 3–8 entries when web search returns relevant hits. EMPTY ARRAY when nothing relevant is found — that is the honest answer.
- DO NOT emit "from": "training" items. The schema no longer permits them. The only valid "from" is "web".
- DO NOT emit items without a URL or without a publishedAt date.
- claims[] target 1–4 entries when items[] is non-empty; emit [] when items is empty.
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

export type NewsOpts = {
  /** When set, news searches the `days`-day window ending at `endsAt` rather
   *  than "the last 30 days from today." The supervisor passes this for
   *  resolved markets — the trader cares about the leadup to resolution,
   *  not "right now." */
  windowOverride?: { endsAt: string; days: number };
};

export async function runNewsAgent(
  ctx: AgentContext,
  provider?: LLMProvider,
  searcher?: Searcher | null,
  opts?: NewsOpts,
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

  // 2) If the news provider has native web search (Perplexity), use it
  //    directly — user-paid-for-key always wins. If not (OpenAI etc.) AND
  //    an Exa searcher is available, route through Exa + the provider for
  //    synthesis. Else, fall through to the legacy "ask the LLM, it'll
  //    hallucinate from training data" path which is what we had before.
  const newsProvider = provider ?? getProvider();
  if (!newsProvider.capabilities.webSearch && searcher) {
    return runNewsViaExa(ctx, started, newsProvider, searcher, opts);
  }
  const allowedTools = newsProvider.capabilities.webSearch ? ['WebSearch'] : [];

  // Route by market sub-category to the curated source profile so the model
  // only cites trader-grade outlets (no Wikipedia / Reddit / open posting
  // platforms — see sources/registry).
  const sub = classifyMarket(market.category ?? '', market.title);
  const profile = profileFor(sub);
  const systemPrompt = buildSystemPrompt(profile.domains, profile.hint);

  // Inject TODAY'S date so the model has a concrete reference for "last
  // 7 days" — without this, models can anchor "recent" to their training
  // cutoff and return 2024 news for a 2026-resolving market.
  const todayIso = new Date().toISOString().slice(0, 10);

  // Resolved markets pass a windowOverride — search the 30 days BEFORE
  // resolution rather than "the last 30 days from today." For active markets
  // this is unset and we use the default rolling-30-day window.
  let windowStart: string;
  let windowEnd: string;
  if (opts?.windowOverride) {
    const endMs = Date.parse(opts.windowOverride.endsAt);
    const startMs = endMs - opts.windowOverride.days * 24 * 60 * 60 * 1000;
    windowStart = new Date(startMs).toISOString().slice(0, 10);
    windowEnd = new Date(endMs).toISOString().slice(0, 10);
  } else {
    const startMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    windowStart = new Date(startMs).toISOString().slice(0, 10);
    windowEnd = todayIso;
  }

  const prompt = `Market title: "${market.title}"
Resolves by: ${market.endDate ?? 'unknown'}
Current YES price: ${market.yes != null ? (market.yes * 100).toFixed(1) + '¢' : 'n/a'}
Today's date: ${todayIso}
Search window: ${windowStart} → ${windowEnd}${opts?.windowOverride ? ' (resolution leadup — this market has already resolved)' : ''}

Build a fast briefing for a trader looking at this contract.
PREFER news from the search window above. Sort items[] newest-first by
publishedAt. If web search comes up thin, return items: [] — the UI's
empty-state takes over. Do NOT fall back to training-data knowledge.`;

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
  // POLICY: no hallucinations. Items must come from real web search with a
  // real URL. Drop anything that's training-data, lacks a URL, lacks a date,
  // or hits the curated denylist. What's left is real news or nothing —
  // both are correct. The UI's "no recent news surfaced" empty state takes
  // over when the array is empty.
  const cleaned: NewsItem[] = rawItems
    .filter(it => {
      // Training-data items are no longer permitted by the SYS prompt. If
      // the model emits one anyway, drop it silently — better empty than
      // fabricated.
      if (it.from === 'training') return false;
      // Items missing a URL or publishedAt are almost always model-fabricated
      // (real search hits carry both). Drop.
      if (!it.url || !it.publishedAt) return false;
      // Denylist domains (Wikipedia / Reddit / Substack / Medium / Forbes
      // contributor / Yahoo aggregator) are not trader-grade. Drop.
      if (isDenylisted(it.url)) return false;
      return true;
    })
    .map(it => {
      // Surviving items have real URLs. Flag as `unverified` if the URL's
      // domain isn't on the curated allowlist for this sub-category — the
      // UI shows a small "unverified" badge but the link is still real
      // and clickable.
      const verified = isAllowlisted(sub, it.url);
      return verified ? it : { ...it, unverified: true };
    });

  // Newest-first. Items with no publishedAt sort to the bottom — they
  // could be anything from "no date metadata available" to ancient
  // training-data backfill, so we'd rather show a dated catalyst above
  // an undated one.
  cleaned.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return tb - ta;
  });

  // Drop stale items (>180 days old). No fallback to keeping stale items
  // anymore — under the no-hallucinations policy, an empty array is the
  // honest answer when there's no fresh news. The UI shows "no recent
  // news surfaced (last 30 days)" instead of stale 2024 catalysts on a
  // live 2026 market.
  const STALE_MS = 180 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const items: NewsItem[] = cleaned.filter((it) => {
    if (!it.publishedAt) return false;
    const t = Date.parse(it.publishedAt);
    if (!Number.isFinite(t)) return false;
    return now - t < STALE_MS;
  }).slice(0, 8);
  const rawClaims: Claim[] = Array.isArray(parsed?.claims) ? parsed!.claims : [];
  const background = typeof parsed?.background === 'string' ? parsed!.background : '';

  // Debug visibility: log occurrence + error class only. Repo policy is no
  // request bodies, market titles, or model output in server logs. The market
  // is still identifiable from the request log line via marketId.
  if (items.length === 0 && rawClaims.length === 0) {
    const errClass = !res.ok ? errorClass(res.error) : 'empty';
    console.warn(`[news] empty result for market=${market.marketId} class=${errClass}`);
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
    // Empty array of claims is fine when items[] is also empty — the UI's
    // "no catalysts surfaced" placeholder takes over. We still emit a
    // single explanatory claim when there's a real provider failure
    // (auth / rate limit / network) so the trader knows it's a tool
    // problem, not "literally no news exists".
    const errMsg = res.error || '';
    const isAuth = /claude-code|Not logged in|Please run \/login|API key|credit balance/i.test(errMsg);
    if (!res.ok && errMsg) {
      claims = [{
        text: isAuth
          ? `news agent failed: provider authentication. ${errMsg.slice(0, 160)}`
          : `news agent failed: ${errMsg.slice(0, 160) || 'provider error'}`,
        citations: [],
      }];
    } else if (items.length === 0) {
      claims = [{
        text: 'no recent news surfaced in the last 30 days for this market from any vetted source. the topic may be too niche, too breaking, or the relevant news may post under different phrasing — try the polymarket comments or search the market title directly.',
        citations: [],
      }];
    }
    // If items.length > 0 but claims.length === 0 (model emitted items but
    // no claims), leave claims = [] — the items render in the news tab on
    // their own without claim summaries.
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

// ─────────────────────────────────────────────────────────────────────
// Exa-backed path: search-then-synthesise.
// ─────────────────────────────────────────────────────────────────────
// Used when the news provider doesn't have native web search (OpenAI,
// Anthropic via API, Google) AND an Exa searcher is configured on the
// server. The flow:
//   1. Exa search with the market title + a recency window (72h news).
//   2. Filter hits through the same denylist + sub-category allowlist
//      the legacy path uses, so citation provenance is identical.
//   3. Pass the cleaned hits to the LLM as STRUCTURED grounding, ask
//      for {background, claims}. The model doesn't need to "search" —
//      it summarises supplied evidence.
//   4. Build citations from the Exa hits (1:1 with the news·N IDs).
async function runNewsViaExa(
  ctx: AgentContext,
  started: number,
  newsProvider: LLMProvider,
  searcher: Searcher,
  opts?: NewsOpts,
): Promise<AgentResult> {
  const { market, emit } = ctx;
  const sub = classifyMarket(market.category ?? '', market.title);
  const profile = profileFor(sub);

  // Resolved-market window override (Task 4) is read inline at the
  // searcher.search() call site below — see `initialDays`.

  // Query construction: "{title} news" + (when known) the sub-category
  // shorthand. Exa's auto type does well with natural-language queries.
  // Search query construction. We try two phrasings — the full market title
  // with recency framing, then a broader keyword-only query — so a market
  // whose exact phrasing returns nothing still has a chance to surface
  // relevant news under simpler search terms. This is the no-hallucinations
  // policy's "search like a normal person" retry: try the obvious query
  // first, then back off to broader terms before declaring empty.
  const titleQuery = `${market.title} — recent news, scheduled events, background context`;
  // Broader query: strip dates / qualifiers, keep just the salient nouns.
  // Cheap heuristic — drop everything after a colon or em-dash and any
  // bracketed date qualifiers. Real failure modes are niche markets where
  // the title is full of date metadata that pollutes the search.
  const broadQuery = market.title
    .replace(/\([^)]*\)/g, '')
    .replace(/[—:].*$/, '')
    .replace(/\b(before|after|by|between|on|in)\s+\w+\s+\d+\s*,?\s*\d{0,4}/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Two-pass recency: prefer last-7-day hits (freshest catalysts that
  // could move an active market), expand to 30 days only if 7 days returned
  // fewer than 4 hits. Then, if STILL thin, retry with the broader keyword
  // query.
  // For resolved-market briefs (windowOverride set), start at the override
  // window (typically 30d before resolution) and skip the expand step.
  let hits: SearchHit[] = [];
  let searchError: string | null = null;
  const initialDays = opts?.windowOverride?.days ?? 7;
  let recencyUsedDays = initialDays;
  try {
    hits = await searcher.search(titleQuery, {
      numResults: 10,
      recencyHours: 24 * initialDays,
      category: 'news',
      withFullText: false,
    });
    if (hits.length < 4 && !opts?.windowOverride) {
      // Niche or slow-news market — widen the window. Merge results so any
      // fresh hits already collected aren't lost when the 30d pass returns
      // mostly older items.
      const wider = await searcher.search(titleQuery, {
        numResults: 10,
        recencyHours: 24 * 30,
        category: 'news',
        withFullText: false,
      });
      const seen = new Set(hits.map((h) => h.url));
      for (const h of wider) {
        if (!seen.has(h.url)) hits.push(h);
      }
      recencyUsedDays = 30;
    }
    // Still thin AND we have a meaningfully different broader query? Try once
    // more with the simpler phrasing. This is the "search like a normal
    // person" fallback before we declare empty-state under the no-
    // hallucinations policy.
    if (hits.length < 3 && broadQuery && broadQuery !== market.title) {
      const broadHits = await searcher.search(broadQuery, {
        numResults: 10,
        recencyHours: 24 * 30,
        category: 'news',
        withFullText: false,
      });
      const seen = new Set(hits.map((h) => h.url));
      for (const h of broadHits) {
        if (!seen.has(h.url)) hits.push(h);
      }
    }
  } catch (err) {
    searchError = err instanceof Error ? err.message : 'exa search failed';
  }
  void recencyUsedDays;

  // Filter through denylist + per-sub-category allowlist (same provenance
  // contract as the legacy path). Sort newest-first so the LLM evidence
  // block and the rendered items both lead with the freshest catalyst.
  const filtered = hits.filter((h) => !isDenylisted(h.url));
  filtered.sort((a, b) => {
    const ta = a.publishedDate ? Date.parse(a.publishedDate) : 0;
    const tb = b.publishedDate ? Date.parse(b.publishedDate) : 0;
    if (!ta && !tb) return (b.score ?? 0) - (a.score ?? 0);
    if (!ta) return 1;
    if (!tb) return -1;
    return tb - ta;
  });
  // Exa hits without a publishedDate are dropped under the no-hallucinations
  // policy: an item with no real date can't be trusted as "fresh news". Real
  // Exa results from vetted-domain news endpoints always carry a date.
  const items: NewsItem[] = filtered
    .filter((h) => Boolean(h.publishedDate))
    .slice(0, 10)
    .map((h) => {
      const item: NewsItem = {
        headline: h.title,
        source: h.domain,
        url: h.url,
        publishedAt: h.publishedDate ?? '',
        snippet: h.snippet,
        relevance: h.score > 0.7 ? 'high' : h.score > 0.4 ? 'med' : 'low',
        from: 'web',
      };
      if (!isAllowlisted(sub, h.url)) item.unverified = true;
      return item;
    });

  // Synthesis pass: give the model the cleaned hits + ask for background
  // and 3-4 claims that cite specific news·N indexes. This is the same
  // claims/background shape the legacy path produces, but the model is
  // working from supplied evidence rather than hallucinated knowledge.
  let claims: Claim[] = [];
  let background = '';
  if (items.length) {
    const evidence = items.map((it, i) => {
      const date = it.publishedAt ? ` (${it.publishedAt.slice(0, 10)})` : '';
      return `[news·${i + 1}] ${it.source}${date} — ${it.headline}\n    ${it.snippet}`;
    }).join('\n');
    const sysPrompt = `You summarise pre-fetched news evidence for a prediction-market trader. The evidence is real and dated; do NOT fabricate. Use ONLY the supplied [news·N] indexes as citations.

Allowed citation pills: ${items.map((_, i) => `[news·${i + 1}]`).join(' ')}

Return JSON ONLY (no fences) with:
{
  "background": "<1-2 sentences explaining what this market is asking about, grounded in the evidence>",
  "claims": [
    { "text": "<concise observation [news·N]>", "citations": ["news·N"] }
  ]
}

Target 3-4 claims. Each cites at least one [news·N] from the supplied list. Keep claims neutral; let the trader form their own view.`;

    const userPrompt = `Market: "${market.title}"
Resolves by: ${market.endDate ?? 'unknown'}
Current YES: ${market.yes != null ? (market.yes * 100).toFixed(1) + '¢' : 'n/a'}

Evidence (pre-fetched from Exa, deny-listed for trader-grade sources):
${evidence}

Build the briefing JSON.`;

    const res = await newsProvider.complete(userPrompt, {
      tier: 'fast',
      systemPrompt: sysPrompt,
      jsonOnly: true,
      timeoutMs: 60_000,
    });
    if (res.ok) {
      const parsed = extractJson<NewsResp>(res.text);
      if (parsed) {
        background = typeof parsed.background === 'string' ? parsed.background : '';
        const validIds = new Set(items.map((_, i) => `news·${i + 1}`));
        claims = (Array.isArray(parsed.claims) ? parsed.claims : [])
          .map((c) => {
            const ids = Array.isArray(c.citations) ? c.citations : [];
            const remapped = ids
              .map((id) => String(id).replace(/[\[\]]/g, '').trim())
              .filter((id) => validIds.has(id));
            return { text: String(c.text ?? '').trim(), citations: remapped };
          })
          .filter((c) => c.text.length > 0)
          .slice(0, 4);
      }
    } else {
      // Synthesis failed — keep the items so the news panel still has
      // something to show, but generate one-liner claims directly from
      // headlines.
      claims = items.slice(0, 3).map((it, i) => ({
        text: `${it.headline} (${it.source}).`,
        citations: [`news·${i + 1}`],
      }));
    }
  }

  if (!claims.length) {
    if (items.length) {
      claims = items.slice(0, 3).map((it, i) => ({
        text: `${it.headline} (${it.source}).`,
        citations: [`news·${i + 1}`],
      }));
    } else if (searchError) {
      claims = [{
        text: `news search failed: ${searchError.slice(0, 160)}`,
        citations: [],
      }];
    } else {
      // Honest empty state under the no-hallucinations policy. No
      // training-data fallback, no fabricated catalysts.
      claims = [{
        text: 'no recent news surfaced in the last 30 days for this market from any vetted source. the topic may be too niche, too breaking, or relevant news may post under different phrasing — try the polymarket comments or search the market title directly.',
        citations: [],
      }];
    }
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

  return {
    agent: 'news',
    output: { claims, citations },
    grounding,
    elapsedMs: Date.now() - started,
    ...(searchError ? { error: searchError } : {}),
  };
}
