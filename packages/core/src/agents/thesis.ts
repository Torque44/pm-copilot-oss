// ThesisAgent — causal sub-claim tree.
//
// Takes the synthesized brief from upstream specialists and produces a
// thesis tree: one top-level claim about the contract → 3-5 testable
// sub-claims → leaf-level probability estimates per sub-claim.
//
// Each leaf cites at least one upstream Citation. The compound probability
// of the leaves is the thesis's fair-price estimate.
//
// Skipped via supervisor when explicitly disabled; otherwise uses primary
// provider's reasoning tier (sonnet / gpt-5 / gemini-pro).

import type { AgentContext, AgentResult, Citation, Claim, SectionOut } from './types';
import type { LLMProvider } from '../providers/types';

const SYS = `You are a prediction-market thesis builder. Given a market and a stack of grounded evidence, produce a structured thesis tree:

- One top-level claim about the YES side of the contract.
- 3-5 testable sub-claims that, if all true, support the top-level claim.
- For each sub-claim, a probability estimate (0..1) and at least one citation ID from the supplied evidence (book·N / whale·N / news·N / kol·N).

Return JSON:
{
  "topClaim": "<one sentence>",
  "subClaims": [
    { "text": "<testable claim>", "probability": 0.62, "citations": ["news·1"] }
  ],
  "compoundProbability": 0.41,
  "killThesis": "<1-2 sentences: what would falsify the thesis?>"
}

Rules:
- Compound probability MUST be the product of sub-claim probabilities (or a justified non-naive aggregation).
- Citations MUST resolve to IDs in the supplied evidence set.
- Stay descriptive; do not recommend trade actions.`;

export type ThesisInput = {
  marketTitle: string;
  yesPrice: number | null;
  evidenceCitations: Citation[]; // book/whale/news/kol citations from upstream
  evidenceClaimSummary: string; // one-paragraph summary of upstream specialists' findings
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

  const userPayload = JSON.stringify({
    market: { title: input.marketTitle, yes: input.yesPrice },
    evidence_summary: input.evidenceClaimSummary,
    valid_citation_ids: [...validIds],
  });

  const res = await provider.complete(userPayload, {
    model: 'reasoning',
    systemPrompt: SYS,
    jsonOnly: true,
    timeoutMs: 60_000,
  });

  type Raw = {
    topClaim?: string;
    subClaims?: Array<{ text?: string; probability?: number; citations?: string[] }>;
    compoundProbability?: number;
    killThesis?: string;
  };

  let parsed: Raw | null = null;
  if (res.ok && res.text) {
    try {
      const m = res.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]) as Raw;
    } catch {
      /* fall through */
    }
  }

  if (!parsed?.topClaim || !Array.isArray(parsed.subClaims)) {
    return {
      agent: 'thesis',
      output: {
        claims: [{ text: 'thesis pass returned unstructured output; skipping.', citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      ...(res.ok ? {} : { error: res.error }),
    };
  }

  const claims: Claim[] = [
    { text: `top: ${parsed.topClaim}`, citations: [] },
    ...parsed.subClaims.map((sc) => ({
      text: `${sc.text} (p=${typeof sc.probability === 'number' ? sc.probability.toFixed(2) : '?'})`,
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

  // Thesis-specific grounding (top claim + sub-claim probabilities) is not in
  // the GroundingData union (book/holders/news only). The structured tree
  // travels via the claim list as encoded text; the UI parses it back.
  return {
    agent: 'thesis',
    output,
    grounding: null,
    elapsedMs: Date.now() - started,
  };
}
