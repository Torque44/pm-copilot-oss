// SentimentAgent — two-pass design to eliminate the LLM URL fabrication
// surface.
//
// Pass 1: xAI Grok with liveSearch ON, minimal prompt. The model's job is
//   just to trigger live X-search. We capture res.citations[] (URLs Grok
//   ACTUALLY pulled) and ignore the model's response text entirely.
//
// Pass 2: liveSearch OFF. The model is given the pre-fetched URLs as
//   numbered evidence ([kol·1] through [kol·N]) and asked to write claims
//   that cite by index. No URLs come out of the model. Anything that leaks
//   through gets filtered by a URL-provenance safety net.
//
// This is the structural fix for the "@Reuters/2023 fabrications" bug —
// the model can't invent tweet URLs because we never ask it to produce
// them.

import type {
  AgentContext,
  AgentResult,
  Citation,
  Claim,
} from './types';
import type { LLMProvider } from '../providers/types';
import {
  classifyMarket,
  isAllowlistedHandle,
  profileFor,
} from '../sources/registry';

export type SentimentInput = {
  marketTitle: string;
  /** Drives the source-profile prompt: politics/crypto/sports/other route
   *  to different authoritative-account lists. */
  category: string;
  yesPrice: number | null;
  noPrice: number | null;
  endDate: string | null;
  /** Legacy bundled-tweet fallback. Unused in the two-pass path but kept
   *  in the signature for backwards compat with the server's supervisor
   *  call site. */
  tweets?: Array<{
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
        claims: [{ text: 'sentiment agent disabled — add an xAI/Grok key in setup to unlock live X search.', citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      error: 'xai-not-configured',
    };
  }

  const sub = classifyMarket(input.category, input.marketTitle);
  const profile = profileFor(sub);
  const vettedHandles = profile.handles.slice(0, 25);

  // ──────────────────────── PASS 1 ────────────────────────
  // Trigger Grok live X-search. The model's text response is ignored —
  // we only consume res.citations[] (real URLs Grok pulled).
  const pass1Prompt = `Find recent X posts about: "${input.marketTitle}". Reply in 1-2 plain sentences summarising what you found — no quotes, no URLs in your reply.`;
  const pass1 = await provider.complete(pass1Prompt, {
    tier: 'fast',
    timeoutMs: 60_000,
    liveSearch: {
      mode: 'on',
      sources: ['x'],
      xHandles: vettedHandles,
      fromDays: 14,
      maxResults: 20,
      returnCitations: true,
    },
  });

  const grokCitations: string[] = pass1.citations ?? [];
  type RegistryEntry = { id: string; handle: string; url: string; n: number };
  const registry: RegistryEntry[] = [];
  for (const url of grokCitations) {
    const handle = parseHandleFromTweetUrl(url);
    if (!handle) continue;
    if (!isAllowlistedHandle(sub, handle)) continue;
    const n = registry.length + 1;
    registry.push({ id: `kol·${n}`, handle, url, n });
  }

  if (registry.length === 0) {
    // No real evidence → honest empty. Skip Pass 2 entirely.
    return {
      agent: 'sentiment',
      output: {
        claims: [{ text: 'no recent X conversation surfaced from vetted handles in the last 14 days for this market.', citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
    };
  }

  // ──────────────────────── PASS 2 ────────────────────────
  // liveSearch OFF. Model gets the registry as numbered evidence and
  // writes claims by [kol·N] index only.
  const evidence = registry.map((r) => `[${r.id}] @${r.handle} — ${r.url}`).join('\n');
  const pass2Sys = `You summarise pre-fetched X posts for a prediction-market trader. The evidence below is real. Write 3-5 short claims about the prevailing view among these vetted voices, citing by index.

Allowed citations: ${registry.map((r) => `[${r.id}]`).join(' ')}

Rules:
- Reference posts ONLY by [kol·N]. Do NOT emit URLs, handles, or your own commentary about source identity.
- Each claim cites at least one [kol·N] from the supplied list.
- Keep claims neutral; let the trader form their own view.

Return JSON ONLY:
{
  "claims": [{ "text": "...", "citations": ["kol·N"] }],
  "lean": "yes" | "no" | "split" | "unclear",
  "confidence": "high" | "med" | "low"
}`;

  const pass2 = await provider.complete(
    `Market: "${input.marketTitle}"\nEvidence:\n${evidence}\n\nReturn the JSON.`,
    {
      tier: 'fast',
      systemPrompt: pass2Sys,
      jsonOnly: true,
      timeoutMs: 30_000,
      // liveSearch intentionally omitted — pure summarisation.
    },
  );

  // Build citations directly from the registry. The model NEVER produces
  // URLs in this pass; we use its claim text + citation indexes only.
  const citations: Citation[] = registry.map((r): Citation => ({
    id: r.id,
    kind: 'kol',
    label: `@${r.handle}`,
    payload: { handle: r.handle, text: '', url: r.url, createdAt: '' },
    url: r.url,
  }));

  type ParsedResp = { claims?: Array<{ text?: string; citations?: string[] }> };
  let parsed: ParsedResp | null = null;
  if (pass2.ok && pass2.text) {
    try {
      const m = pass2.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]) as ParsedResp;
    } catch { /* fall through */ }
  }

  const validIds = new Set(registry.map((r) => r.id));
  const registryUrls = new Set(registry.map((r) => r.url));

  const claims: Claim[] = Array.isArray(parsed?.claims)
    ? parsed!.claims
        .map((c) => ({
          text: String(c.text || '').trim(),
          citations: Array.isArray(c.citations)
            ? c.citations.filter((id) => validIds.has(id))
            : [],
        }))
        .filter((c) => c.text.length > 0)
        // Safety net: drop any claim whose text leaks a URL not in the
        // registry. Pass-2 sys prompt forbids URLs entirely; if one slips
        // in we drop the whole claim rather than partially trust it.
        .filter((c) => {
          const urlsInClaim = c.text.match(/https?:\/\/\S+/g) ?? [];
          return urlsInClaim.every((u) => registryUrls.has(u));
        })
        .slice(0, 5)
    : [];

  if (claims.length === 0) {
    return {
      agent: 'sentiment',
      output: {
        claims: [{ text: 'no recent X conversation surfaced. try again in a few minutes — fresh posts arrive throughout the day.', citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      ...(pass2.ok ? {} : { error: pass2.error }),
    };
  }

  return {
    agent: 'sentiment',
    output: { claims, citations },
    grounding: null,
    elapsedMs: Date.now() - started,
  };
}

/** Parse @handle from an X/Twitter post URL.
 *  Accepts https://x.com/{handle}/status/{id} and twitter.com variants. */
function parseHandleFromTweetUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'x.com' && host !== 'twitter.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 3 || parts[1] !== 'status') return null;
    return parts[0] ?? null;
  } catch {
    return null;
  }
}
