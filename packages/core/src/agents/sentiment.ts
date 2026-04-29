// SentimentAgent — X-native KOL takes via xAI/Grok.
//
// Differs from News agent (which fetches dated catalysts from web sources):
// Sentiment pulls last N tweets from PM-active KOLs about the market topic,
// has Grok rate aggregate sentiment, returns 3-5 dated quotes with attribution.
// Output citations are `kol·N` tags linking to actual tweet URLs.
//
// Skipped entirely if xAI is not configured. Panel tab is greyed in UI.

import type { AgentContext, AgentResult, Citation, Claim, SectionOut } from './types';
import type { LLMProvider } from '../providers/types';

const SYS = `You are a prediction-market sentiment analyst. You read recent X posts from prediction-market traders and analysts, then output 3-5 SHORT claims about the prevailing sentiment toward a specific contract.

Rules:
- Every claim MUST reference a specific tweet from the snapshot.
- Every claim ends with one or more citation IDs in the form [kol·N] where N corresponds to the tweet entry referenced (1 = first entry, 2 = second, etc).
- Do not invent tweets. Do not paraphrase aggressively. Quote when possible.
- Output an aggregate "lean" (yes-leaning / no-leaning / split / unclear) at the end.

Return JSON with this exact shape:
{
  "claims": [
    { "text": "<short claim with [kol·N] citation>", "citations": ["kol·1", "kol·3"] }
  ],
  "lean": "yes" | "no" | "split" | "unclear",
  "confidence": "high" | "med" | "low"
}`;

export type SentimentInput = {
  marketTitle: string;
  yesPrice: number | null;
  noPrice: number | null;
  endDate: string | null;
  // Tweets seeded from x_search_tweets MCP (when wired) or curated KOL list
  tweets: Array<{
    handle: string;
    text: string;
    url: string;
    createdAt: string;
    likes?: number;
    replies?: number;
  }>;
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
            text: 'sentiment agent disabled — add an xAI/Grok key in settings to unlock.',
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

  if (!input.tweets.length) {
    return {
      agent: 'sentiment',
      output: {
        claims: [{ text: 'no recent X mentions found for this contract.', citations: [] }],
        citations: [],
      },
      // Sentiment is not in the GroundingData union (book/holders/news only).
      // The raw tweet stream travels via the citation list instead.
      grounding: null,
      elapsedMs: Date.now() - started,
    };
  }

  // Build citations registry: kol·1 = first tweet, kol·2 = second, ...
  const citations: Citation[] = input.tweets.map((t, i) => ({
    id: `kol·${i + 1}`,
    kind: 'kol',
    label: `@${t.handle}`,
    payload: t,
    url: t.url,
  }));

  const userPayload = JSON.stringify({
    market: { title: input.marketTitle, yes: input.yesPrice, no: input.noPrice, ends: input.endDate },
    tweets: input.tweets.map((t, i) => ({
      idx: i + 1,
      handle: t.handle,
      text: t.text.slice(0, 280),
      url: t.url,
      ts: t.createdAt,
    })),
  });

  const res = await provider.complete(userPayload, {
    model: 'fast',
    systemPrompt: SYS,
    jsonOnly: true,
    timeoutMs: 60_000,
  });

  let parsed: { claims?: Claim[]; lean?: string; confidence?: string } | null = null;
  if (res.ok && res.text) {
    try {
      const m = res.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch {
      /* fall through to fallback */
    }
  }

  const claims: Claim[] = parsed?.claims?.length
    ? parsed.claims.map((c) => ({
        text: String(c.text || '').trim(),
        citations: Array.isArray(c.citations)
          ? c.citations.filter((id) => citations.some((cit) => cit.id === id))
          : [],
      }))
    : [
        {
          text: `${input.tweets.length} recent X mentions; sentiment LLM unavailable, raw tweets cited as evidence.`,
          citations: citations.slice(0, 3).map((c) => c.id),
        },
      ];

  const output: SectionOut = { claims, citations };

  // Note: sentiment grounding (raw tweets + lean/confidence) lives only on the
  // citation list because GroundingData is currently book/holders/news.
  // Future: extend the union with a SentimentGrounding variant.
  return {
    agent: 'sentiment',
    output,
    grounding: null,
    elapsedMs: Date.now() - started,
    ...(res.ok ? {} : { error: res.error }),
  };
}
