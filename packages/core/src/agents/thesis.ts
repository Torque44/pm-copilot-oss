// ThesisAgent — two-pass causal sub-claim tree.
//
// Pass 1: prose analysis (no JSON pressure). Reasoning model thinks through
//   the market, establishes base rate, walks through what needs to happen,
//   and identifies the kill-thesis.
// Pass 2: extract structured JSON from pass 1's prose. If pass 2 fails we
//   fall back to a tolerant prose parser that pulls out claims by structure.
//
// The two-pass design exists because reasoning models (Sonnet/Grok-3/o1)
// frequently refuse to emit clean JSON on contentious topics but will write
// good analysis if asked for prose first. Splitting the ask gets us a useful
// answer in cases where the strict JSON-only path returned a refusal.

import type {
  AgentContext,
  AgentResult,
  Citation,
  Claim,
  SectionOut,
} from './types';
import type { LLMProvider } from '../providers/types';

const ANALYSIS_SYS = `You are a prediction-market thesis builder. You think analytically about contracts and surface the causal chain a trader needs to evaluate them. You DO NOT recommend trades — you describe.

Given a market and a stack of upstream evidence, write a short analytical brief covering:

1. **Base rate** — comparable historical markets / events of this shape, and how often they resolve YES. If no obvious base rate, say so.
2. **Sub-claims for YES** — the 3-5 things that would all need to hold for the YES side to resolve. Treat each as testable.
3. **Probability estimate** for each sub-claim (0..1). Be concrete; "I think 65%" beats "uncertain".
4. **Compound probability** — your fair-price estimate for YES. Show your math (product of sub-claims, or note non-naive aggregation).
5. **Kill thesis** — the single most likely failure mode that would falsify YES.

Cite upstream evidence by ID where relevant ([book-stats], [whale·1], [news·3], [kol·2], etc) — only IDs that appear in the supplied evidence set.

Use plain text with simple section headings. No markdown fences. Write tight; this is a reading aid, not an essay.`;

const EXTRACT_SYS = `Convert the analytical brief below into JSON ONLY (no prose, no markdown fences):

{
  "topClaim": "<one sentence stating the YES thesis in causal terms>",
  "subClaims": [
    { "text": "<testable claim>", "probability": 0.62, "citations": ["news·1"] }
  ],
  "compoundProbability": 0.41,
  "killThesis": "<1-2 sentences: what falsifies the thesis>"
}

Rules:
- Pull subClaims directly from the analysis (3-5 entries).
- Citations MUST be IDs that appeared in the source analysis or the supplied valid_citation_ids list.
- compoundProbability is the trader's fair-price estimate for YES.`;

export type ThesisInput = {
  marketTitle: string;
  yesPrice: number | null;
  evidenceCitations: Citation[];
  evidenceClaimSummary: string;
};

type StructuredResp = {
  topClaim?: string;
  subClaims?: Array<{ text?: string; probability?: number; citations?: string[] }>;
  compoundProbability?: number;
  killThesis?: string;
};

export async function runThesisAgent(
  ctx: AgentContext,
  provider: LLMProvider | null,
  input: ThesisInput,
): Promise<AgentResult> {
  const started = Date.now();

  if (!provider) {
    return {
      agent: 'thesis',
      output: {
        claims: [{ text: 'thesis agent disabled (no primary provider).', citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      error: 'no-provider',
    };
  }

  const validIds = new Set(input.evidenceCitations.map((c) => c.id));
  void ctx;

  // ---- Pass 1: prose analysis ----
  const analysisPrompt = `Market: "${input.marketTitle}"
Current YES price: ${input.yesPrice != null ? (input.yesPrice * 100).toFixed(1) + '¢' : 'unknown'}

Upstream evidence summary:
${input.evidenceClaimSummary || '(no upstream evidence yet)'}

Valid citation IDs (only these resolve to real sources):
${[...validIds].slice(0, 30).join(', ') || '(none)'}

Write the thesis brief.`;

  const passOne = await provider.complete(analysisPrompt, {
    tier: 'reasoning',
    systemPrompt: ANALYSIS_SYS,
    timeoutMs: 90_000,
  });

  if (!passOne.ok || !passOne.text) {
    const sample = (passOne.text || '').replace(/\s+/g, ' ').slice(0, 300);
    const errMsg = passOne.error || '';
    console.warn(
      `[thesis] pass-1 failed for "${input.marketTitle}" (${errMsg || 'no text'}): ${sample}`,
    );
    const isAuth = /claude-code|Not logged in|Please run \/login|API key|credit balance/i.test(errMsg);
    return {
      agent: 'thesis',
      output: {
        claims: [
          {
            text: isAuth
              ? `thesis agent failed: provider authentication. ${errMsg.slice(0, 160)}`
              : `thesis agent failed: ${errMsg.slice(0, 160) || 'no response from provider'}`,
            citations: [],
          },
        ],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      error: errMsg,
    };
  }

  const analysis = passOne.text;

  // ---- Pass 2: structured extraction ----
  const extractPrompt = `Source analysis:
${analysis}

valid_citation_ids: ${[...validIds].slice(0, 30).join(', ') || '(none)'}`;

  const passTwo = await provider.complete(extractPrompt, {
    tier: 'fast',
    systemPrompt: EXTRACT_SYS,
    jsonOnly: true,
    timeoutMs: 30_000,
  });

  let parsed: StructuredResp | null = null;
  if (passTwo.ok && passTwo.text) {
    try {
      const m = passTwo.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]) as StructuredResp;
    } catch {
      /* fall through to prose parser */
    }
  }

  // Tolerant fallback: if pass-2 didn't yield valid structure, parse pass-1
  // prose by splitting on numbered sub-claims. We don't get probabilities
  // from this path, but we still get a usable thesis tree.
  if (!parsed?.topClaim || !Array.isArray(parsed.subClaims) || parsed.subClaims.length === 0) {
    parsed = extractFromProse(analysis, validIds);
  }

  if (!parsed?.topClaim || parsed.subClaims!.length === 0) {
    const sample = analysis.replace(/\s+/g, ' ').slice(0, 300);
    console.warn(`[thesis] both passes failed for "${input.marketTitle}": ${sample}`);
    return {
      agent: 'thesis',
      output: {
        claims: [{ text: 'thesis pass returned unstructured output; skipping.', citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
    };
  }

  const subClaims = parsed.subClaims!;
  const claims: Claim[] = [
    { text: `top: ${parsed.topClaim}`, citations: [] },
    ...subClaims.map((sc) => ({
      text: `${sc.text}${typeof sc.probability === 'number' ? ` (p=${sc.probability.toFixed(2)})` : ''}`,
      citations: Array.isArray(sc.citations) ? sc.citations.filter((id) => validIds.has(id)) : [],
    })),
    {
      text: `compound: ${parsed.compoundProbability != null ? parsed.compoundProbability.toFixed(2) : '?'}${
        parsed.killThesis ? ' · kill: ' + parsed.killThesis : ''
      }`,
      citations: [],
    },
  ];

  const output: SectionOut = { claims, citations: [] };
  return {
    agent: 'thesis',
    output,
    grounding: null,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Last-resort: parse the analytical prose into a rough StructuredResp.
 * Heuristics:
 *  - Lines like "1. ...", "- ...", "• ..." under a "sub-claims" header become subClaims
 *  - First non-header sentence = topClaim
 *  - "kill thesis" / "kill:" line → killThesis
 *  - "compound" / "fair price" / "YES probability" line with a percent → compoundProbability
 */
function extractFromProse(text: string, validIds: Set<string>): StructuredResp {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let topClaim = '';
  const subClaims: NonNullable<StructuredResp['subClaims']> = [];
  let killThesis = '';
  let compoundProbability: number | undefined;

  let inSubClaims = false;
  for (const line of lines) {
    const lower = line.toLowerCase();

    if (/^(top( claim)?|conclusion|thesis):/i.test(line) && !topClaim) {
      topClaim = line.replace(/^[^:]*:\s*/, '').trim();
      continue;
    }

    if (/sub[-\s]?claims?|the [0-9]+ things?|what (would|needs to) happen/i.test(lower)) {
      inSubClaims = true;
      continue;
    }
    if (/kill[-\s]?thesis|failure mode|what (would|could) falsify/i.test(lower)) {
      inSubClaims = false;
      killThesis = line.replace(/^[^:]*:\s*/, '').trim();
      continue;
    }
    if (/compound|fair price|yes probability|aggregat/i.test(lower)) {
      const pct = line.match(/(\d{1,3})\s*%/);
      const dec = line.match(/0?\.\d{1,2}/);
      if (pct && pct[1]) compoundProbability = Math.max(0, Math.min(1, Number(pct[1]) / 100));
      else if (dec) compoundProbability = Math.max(0, Math.min(1, Number(dec[0])));
      continue;
    }

    // Numbered/bulleted sub-claims under the sub-claims header.
    const bullet = line.match(/^(?:[0-9]+[.)]|[-•*])\s+(.+)/);
    if (bullet && bullet[1] && inSubClaims && subClaims.length < 5) {
      const claimText = bullet[1].trim();
      const cited = [...claimText.matchAll(/\[([^\]]+)\]/g)]
        .map((m) => m[1]!.trim())
        .filter((id) => validIds.has(id));
      const probMatch = claimText.match(/p\s*=\s*(0?\.\d{1,2}|\d{1,3}\s*%)/i);
      let probability: number | undefined;
      if (probMatch && probMatch[1]) {
        const raw = probMatch[1];
        probability = raw.includes('%')
          ? Number(raw.replace('%', '').trim()) / 100
          : Number(raw);
      }
      const entry: NonNullable<StructuredResp['subClaims']>[number] = {
        text: claimText,
        citations: cited,
      };
      if (typeof probability === 'number') entry.probability = probability;
      subClaims.push(entry);
    }
  }

  // If we found bullets but never saw a 'top' header, take the first non-bullet
  // line as the top claim.
  if (!topClaim) {
    for (const line of lines) {
      if (!/^(?:[0-9]+[.)]|[-•*])/.test(line) && !/^[a-z\s]+:/i.test(line)) {
        topClaim = line;
        break;
      }
    }
  }

  return { topClaim, subClaims, compoundProbability, killThesis };
}
