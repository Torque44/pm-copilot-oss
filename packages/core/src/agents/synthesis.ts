// SynthesisAgent — writes the final 5-section Pregame Brief. Sonnet-tier.
//
// Input: outputs from market, holders, news agents + market metadata.
// Output: Brief (5 sections of Claims preserving citation IDs) + overall verdict/confidence.
//
// The synthesis must preserve citation IDs from the upstream agents. It is allowed to
// rephrase claims but must not invent citation IDs.

import { getProvider } from '../providers/index';
import { extractJson, type LLMProvider } from '../providers/types';
import type {
  AgentContext,
  AgentResult,
  AgentEvent,
  Brief,
  BriefSectionName,
  Citation,
  Claim,
  SectionOut,
} from './types';

const SYS = `You are PM Copilot. You write short, grounded Pregame Briefs for prediction-market traders.

You will receive:
- market_meta: title, end date, current YES/NO, volume
- market_section: claims about the orderbook (cite [book·...])
- holders_section: claims about top holders (cite [whale·...])
- news_section: claims about catalysts and news (cite [news·...])

Produce a Pregame Brief with EXACTLY these five sections:

1. SETUP (2 short sentences): what this market is and when it resolves.
2. BOOK & LIQUIDITY: reuse the market claims. You may rephrase slightly but preserve the citation IDs.
3. SMART MONEY: reuse the holder claims. Preserve citation IDs.
4. CATALYSTS: reuse the news claims. Preserve citation IDs.
5. VERDICT (1 sentence): your read. Must include an EDGE judgment ("yes", "no", or "none") and a CONFIDENCE ("low", "med", "high"). Cite at least two upstream citations supporting the call.

Return JSON with this exact shape:
{
  "sections": {
    "setup":     [{ "text": "...", "citations": [] }],
    "book":      [{ "text": "...", "citations": ["book·stats"] }],
    "smart":     [{ "text": "...", "citations": ["whale·1"] }],
    "catalysts": [{ "text": "...", "citations": ["news·1"] }],
    "verdict":   [{ "text": "Fair value looks ~58¢, market at 62¢, 4¢ edge to NO given concentrated long positions and no near-term catalyst.", "citations": ["book·stats","whale·stats"] }]
  },
  "edge": "yes",
  "confidence": "med"
}

Rules:
- Setup claims may have empty citations (they're intro).
- Every other section must preserve upstream citation IDs (don't invent new ones).
- Keep total length tight — each section 1–3 claims max.`;

type SynthIn = {
  market: AgentContext['market'];
  market_section: SectionOut;
  holders_section: SectionOut;
  news_section: SectionOut;
};

type SynthRaw = {
  sections?: Partial<Record<BriefSectionName, Claim[]>>;
  edge?: 'yes' | 'no' | 'none' | string;
  confidence?: 'high' | 'med' | 'low' | string;
};

export async function runSynthesis(
  inp: SynthIn,
  ctx: AgentContext,
  provider?: LLMProvider,
): Promise<AgentResult & { brief: Brief }> {
  const started = Date.now();

  // Merge all citations into one lookup; dedupe by id (later wins).
  const allCitations: Citation[] = [];
  const seenIds = new Set<string>();
  for (const c of [...inp.market_section.citations, ...inp.holders_section.citations, ...inp.news_section.citations]) {
    if (seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    allCitations.push(c);
  }

  const validIds = new Set(allCitations.map(c => c.id));

  const payload = {
    market_meta: {
      title: inp.market.title,
      end_date: inp.market.endDate,
      yes_price: inp.market.yes,
      no_price: inp.market.no,
      volume_24hr: inp.market.volume24hr,
      volume_total: inp.market.volumeTotal,
      category: inp.market.category,
    },
    market_section: inp.market_section.claims,
    holders_section: inp.holders_section.claims,
    news_section: inp.news_section.claims,
  };

  const res = await (provider ?? getProvider()).complete(JSON.stringify(payload, null, 2), {
    tier: 'reasoning',
    systemPrompt: SYS,
    jsonOnly: true,
    timeoutMs: 30_000,
  });

  const parsed = res.ok ? extractJson<SynthRaw>(res.text) : null;

  const brief = buildBrief(parsed, inp, allCitations, validIds);

  // Fake-stream each section with a 200ms stagger so UI feels alive.
  const order: BriefSectionName[] = ['setup', 'book', 'smart', 'catalysts', 'verdict'];
  for (const name of order) {
    ctx.emit({ t: 'brief:section', name, claims: brief.sections[name] });
    // 200ms stagger for the feel
    await sleep(180);
  }

  ctx.emit({ t: 'brief:complete', brief });

  const claimsOut: Claim[] = order.flatMap(n => brief.sections[n]);

  return {
    agent: 'synthesis',
    output: { claims: claimsOut, citations: allCitations },
    grounding: null,
    elapsedMs: Date.now() - started,
    brief,
    ...(res.ok ? {} : { error: res.error }),
  };
}

function buildBrief(
  parsed: SynthRaw | null,
  inp: SynthIn,
  allCitations: Citation[],
  validIds: Set<string>
): Brief {
  const normaliseSection = (claims: Claim[] | undefined, fallback: Claim[]): Claim[] => {
    if (!Array.isArray(claims) || !claims.length) return fallback;
    const mapped = claims.map(c => ({
      text: String(c.text ?? '').trim(),
      citations: Array.isArray(c.citations)
        ? Array.from(new Set(c.citations
          .map(id => String(id).replace(/[\[\]]/g, '').trim())
          .filter(id => validIds.has(id))))
        : [],
    })).filter(c => c.text.length > 0);
    // If the LLM returned claims but every single one had empty text (rare), fall back.
    return mapped.length ? mapped : fallback;
  };

  const setupFallback: Claim[] = [{
    text: `${inp.market.title} resolves ${formatEndDate(inp.market.endDate)}. Currently trading at ${inp.market.yes != null ? (inp.market.yes * 100).toFixed(1) + '¢' : 'n/a'} YES.`,
    citations: [],
  }];

  const sections = {
    setup: normaliseSection(parsed?.sections?.setup, setupFallback),
    book: normaliseSection(parsed?.sections?.book, inp.market_section.claims),
    smart: normaliseSection(parsed?.sections?.smart, inp.holders_section.claims),
    catalysts: normaliseSection(parsed?.sections?.catalysts, inp.news_section.claims),
    verdict: normaliseSection(parsed?.sections?.verdict, [{
      text: `No clear edge — insufficient signal across book, positioning, and catalysts.`,
      citations: [],
    }]),
  };

  const edge = normaliseEnum(parsed?.edge, ['yes', 'no', 'none']) ?? 'none';
  const confidence = normaliseEnum(parsed?.confidence, ['high', 'med', 'low']) ?? 'low';

  return {
    sections,
    edge: edge as 'yes' | 'no' | 'none',
    confidence: confidence as 'high' | 'med' | 'low',
    citations: allCitations,
    market: inp.market,
  };
}

function normaliseEnum(val: unknown, allowed: string[]): string | null {
  if (typeof val !== 'string') return null;
  const v = val.trim().toLowerCase();
  return allowed.includes(v) ? v : null;
}

function formatEndDate(iso: string | null): string {
  if (!iso) return 'soon';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'soon';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
