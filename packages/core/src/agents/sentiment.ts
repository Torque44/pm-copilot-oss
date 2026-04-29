// SentimentAgent — Grok live X-search.
//
// Uses xAI/Grok's Live Search API (search_parameters: {mode:'on', sources:[
// {type:'x'}]}) so Grok pulls fresh tweets relevant to the market at request
// time. We no longer depend on a curated stub feed for primary input — the
// stub is now only used as a fallback when:
//   1. The provider isn't xAI (only xAI has live X access today)
//   2. Live search returns nothing
//
// Output: 3-5 short claims with [kol·N] citations linking to real tweet URLs
// Grok cited during search.

import type {
  AgentContext,
  AgentResult,
  Citation,
  Claim,
  SectionOut,
} from './types';
import type { LLMProvider } from '../providers/types';

const SYS = `You are a prediction-market sentiment analyst. Search X (twitter) for recent posts about the market and summarise the prevailing trader take.

Rules:
- Output 3-5 short claims about how prediction-market-savvy traders are
  positioning or talking about this contract.
- Each claim MUST end with one or more citation tags [kol·N] referencing
  the tweet you used (1 = first cited tweet, 2 = second, …).
- For each [kol·N] you reference, populate \`tweets\` with: handle (no @),
  one-sentence excerpt (≤200 chars), url, ts (ISO timestamp if known).
- Do not invent tweets. If the live search returned nothing useful, return
  empty claims + empty tweets — do not hallucinate.
- Aggregate "lean" describes the consensus among the cited posts.

Return JSON ONLY, no prose:
{
  "claims": [{ "text": "<claim with [kol·N]>", "citations": ["kol·1"] }],
  "tweets": [{ "n": 1, "handle": "0xayushya", "excerpt": "...", "url": "https://x.com/...", "ts": "2026-04-29T..." }],
  "lean": "yes" | "no" | "split" | "unclear",
  "confidence": "high" | "med" | "low"
}`;

export type SentimentInput = {
  marketTitle: string;
  yesPrice: number | null;
  noPrice: number | null;
  endDate: string | null;
  /** Optional pre-curated tweets used as a fallback when live search isn't
   *  available (e.g. provider isn't xAI). The stub feed in
   *  packages/core/src/mcp/loaders/x-stub-data.json populates this. */
  tweets?: Array<{
    handle: string;
    text: string;
    url: string;
    createdAt: string;
    likes?: number;
    replies?: number;
  }>;
};

type ParsedResponse = {
  claims?: Array<{ text?: string; citations?: string[] }>;
  tweets?: Array<{
    n?: number;
    handle?: string;
    excerpt?: string;
    url?: string;
    ts?: string;
  }>;
  lean?: string;
  confidence?: string;
};

export async function runSentimentAgent(
  ctx: AgentContext,
  provider: LLMProvider | null,
  input: SentimentInput,
): Promise<AgentResult> {
  const started = Date.now();

  if (!provider) {
    return {
      agent: 'sentiment',
      output: {
        claims: [
          {
            text: 'sentiment agent disabled — add an xAI/Grok key in setup to unlock live X search.',
            citations: [],
          },
        ],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      error: 'xai-not-configured',
    };
  }

  // Pull market context the model needs to phrase the search.
  const yesStr = typeof input.yesPrice === 'number' ? `${(input.yesPrice * 100).toFixed(1)}%` : '?';
  const noStr = typeof input.noPrice === 'number' ? `${(input.noPrice * 100).toFixed(1)}%` : '?';
  const endStr = input.endDate ? `resolves by ${input.endDate.slice(0, 10)}` : '';

  const userPrompt = `Market: "${input.marketTitle}"
Current price: YES ${yesStr} / NO ${noStr}${endStr ? ' · ' + endStr : ''}

Search X for recent (last 14 days) posts that:
  - Discuss this market directly OR
  - Discuss the underlying question / event with conviction
  - Especially from accounts that trade prediction markets, follow the topic closely, or have macro/policy expertise

Surface 3-5 representative takes that capture the conversation.`;

  const res = await provider.complete(userPrompt, {
    tier: 'fast',
    systemPrompt: SYS,
    jsonOnly: true,
    timeoutMs: 60_000,
    liveSearch: {
      mode: 'on',
      sources: ['x'],
      fromDays: 14,
      maxResults: 15,
      returnCitations: true,
    },
  });

  let parsed: ParsedResponse | null = null;
  if (res.ok && res.text) {
    try {
      const m = res.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]) as ParsedResponse;
    } catch {
      /* fall through */
    }
  }

  // Build citation list from the model's reported tweets. Each entry maps
  // n → kol·N so the [kol·N] tags inside claims resolve to real tweet URLs.
  const citations: Citation[] = [];
  const tweetsRaw = Array.isArray(parsed?.tweets) ? parsed!.tweets : [];
  for (const t of tweetsRaw) {
    if (typeof t.n !== 'number' || !t.url) continue;
    const id = `kol·${t.n}`;
    const handle = (t.handle || '').replace(/^@/, '').trim();
    const cit: Citation = {
      id,
      kind: 'kol',
      label: handle ? `@${handle}` : id,
      payload: {
        handle,
        text: t.excerpt || '',
        url: t.url,
        createdAt: t.ts || '',
      },
      url: t.url,
    };
    citations.push(cit);
  }

  const validIds = new Set(citations.map((c) => c.id));
  const claims: Claim[] = Array.isArray(parsed?.claims)
    ? parsed!.claims
        .map((c) => ({
          text: String(c.text || '').trim(),
          citations: Array.isArray(c.citations)
            ? c.citations.filter((id) => validIds.has(id))
            : [],
        }))
        .filter((c) => c.text.length > 0)
        .slice(0, 5)
    : [];

  // If live search returned nothing AND we have a fallback stub, re-run
  // against the stub. This rescues niche markets when Grok finds zero hits.
  if (claims.length === 0 && input.tweets && input.tweets.length > 0) {
    const stubResult = await runWithStubTweets(ctx, provider, input);
    return stubResult;
  }

  if (claims.length === 0) {
    // Log the raw output so we can debug refusals/empty searches.
    const sample = (res.text || '').replace(/\s+/g, ' ').slice(0, 300);
    console.warn(
      `[sentiment] empty result for "${input.marketTitle}" (${res.ok ? 'ok' : 'err: ' + res.error}, ${Date.now() - started}ms): ${sample}`,
    );
    return {
      agent: 'sentiment',
      output: {
        claims: [
          {
            text: 'no recent X conversation surfaced. try again in a few minutes — fresh posts arrive throughout the day.',
            citations: [],
          },
        ],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      ...(res.ok ? {} : { error: res.error }),
    };
  }

  const output: SectionOut = { claims, citations };
  return {
    agent: 'sentiment',
    output,
    grounding: null,
    elapsedMs: Date.now() - started,
  };
}

/** Fallback path: re-run sentiment using the bundled stub tweets when Grok's
 *  live search came back empty. This is only invoked for very niche markets
 *  where the curated stub happens to have relevant entries. */
async function runWithStubTweets(
  _ctx: AgentContext,
  provider: LLMProvider,
  input: SentimentInput,
): Promise<AgentResult> {
  const started = Date.now();
  if (!input.tweets || input.tweets.length === 0) {
    return {
      agent: 'sentiment',
      output: { claims: [], citations: [] },
      grounding: null,
      elapsedMs: 0,
    };
  }

  const citations: Citation[] = input.tweets.map((t, i) => ({
    id: `kol·${i + 1}`,
    kind: 'kol',
    label: `@${t.handle}`,
    payload: t,
    url: t.url,
  }));

  const stubSys = `You are a prediction-market sentiment analyst. Read the supplied tweets and output 3-5 short claims about the prevailing trader take. Every claim must cite tweets by [kol·N] where N is the 1-indexed entry. Return JSON: { "claims": [{"text":"...","citations":["kol·N"]}], "lean":"yes|no|split|unclear", "confidence":"high|med|low" }`;

  const userPayload = JSON.stringify({
    market: {
      title: input.marketTitle,
      yes: input.yesPrice,
      no: input.noPrice,
      ends: input.endDate,
    },
    tweets: input.tweets.map((t, i) => ({
      idx: i + 1,
      handle: t.handle,
      text: t.text.slice(0, 280),
      url: t.url,
      ts: t.createdAt,
    })),
  });

  const res = await provider.complete(userPayload, {
    tier: 'fast',
    systemPrompt: stubSys,
    jsonOnly: true,
    timeoutMs: 30_000,
  });

  type StubResp = { claims?: Array<{ text?: string; citations?: string[] }> };
  let parsed: StubResp | null = null;
  if (res.ok && res.text) {
    try {
      const m = res.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]) as StubResp;
    } catch {
      /* fall through */
    }
  }

  const validIds = new Set(citations.map((c) => c.id));
  const claims: Claim[] = Array.isArray(parsed?.claims)
    ? parsed!.claims
        .map((c) => ({
          text: String(c.text || '').trim(),
          citations: Array.isArray(c.citations)
            ? c.citations.filter((id) => validIds.has(id))
            : [],
        }))
        .filter((c) => c.text.length > 0)
        .slice(0, 5)
    : [];

  if (claims.length === 0) {
    return {
      agent: 'sentiment',
      output: {
        claims: [{ text: 'no relevant X conversation in the bundled feed for this market.', citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
    };
  }

  return {
    agent: 'sentiment',
    output: { claims, citations },
    grounding: null,
    elapsedMs: Date.now() - started,
  };
}
