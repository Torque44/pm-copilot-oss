// HoldersAgent — pulls top holders via the venue's data feed, then asks the
// LLM provider for 2–4 claims about concentration, side bias, and notable
// whales. Like MarketAgent, it never reads venue APIs directly — the registry
// routes holder reads to the right feed (built-in Polymarket / user MCP).

import { feed as feedFor } from '../mcp/registry';
import { getProvider } from '../providers/index';
import { extractJson, type LLMProvider } from '../providers/types';
import type {
  AgentContext,
  AgentResult,
  Citation,
  Claim,
  HoldersGrounding,
  HolderRow,
  SectionOut,
} from './types';

const SYS = `You are a prediction-market positioning analyst.

Given a JSON snapshot of the top holders (across both outcomes, with USD sizes and sides), output 2–4 SHORT claims about concentration, directional conviction, and any notable whales.

Rules:
- Every claim MUST cite at least one [whale·N] (referring to the holder at rank N, 1-indexed) OR [whale·stats] for aggregate stats.
- Focus on things a trader cares about: who dominates, which side has more money, are there notable outliers.
- If a named account (non-0x) appears in the top ranks, mention the name.
- Do not speculate about intent.

Return JSON with this exact shape:
{
  "claims": [
    { "text": "<claim with [whale·N] or [whale·stats] citations>", "citations": ["whale·1"] }
  ]
}`;

export async function runHoldersAgent(
  ctx: AgentContext,
  provider?: LLMProvider,
): Promise<AgentResult> {
  const started = Date.now();
  const { market, emit } = ctx;

  const venue = market.venue ?? 'polymarket';
  const dataFeed = feedFor(venue, 'holders');

  if (!dataFeed?.getTopHolders) {
    return {
      agent: 'holders',
      output: {
        claims: [{ text: `No holders feed registered for venue "${venue}".`, citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      error: `no holders feed for venue ${venue}`,
    };
  }

  let grounding: HoldersGrounding | null;
  try {
    grounding = await dataFeed.getTopHolders(market);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return {
      agent: 'holders',
      output: {
        claims: [{
          text: `Holder data unavailable: ${msg}.`,
          citations: [],
        }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      error: msg || 'fetch failed',
    };
  }

  if (!grounding) {
    return {
      agent: 'holders',
      output: {
        claims: [{ text: `Holders unavailable from feed "${dataFeed.descriptor.id}".`, citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      error: 'feed returned null',
    };
  }

  const { rows, concentrationTop5Pct, totalHolderUsd, sideBias } = grounding;
  const { yesUsd, noUsd, yesPct } = sideBias;

  emit({ t: 'agent:data', agent: 'holders', grounding });

  const citations: Citation[] = rows.slice(0, 10).map((r, i) => ({
    id: `whale·${i + 1}`,
    kind: 'whale' as const,
    label: `whale·${i + 1}`,
    payload: r,
  }));
  citations.push({
    id: 'whale·stats',
    kind: 'whale',
    label: 'whale·stats',
    payload: { concentrationTop5Pct, totalHolderUsd, yesUsd, noUsd, yesPct },
  });

  if (!rows.length) {
    return {
      agent: 'holders',
      output: {
        claims: [{
          text: 'No holders reported — market is brand new or has no material positions yet.',
          citations: ['whale·stats'],
        }],
        citations,
      },
      grounding,
      elapsedMs: Date.now() - started,
    };
  }

  const payload = {
    market_title: market.title,
    top_holders: rows.slice(0, 10).map((r, i) => ({
      rank: i + 1,
      address: r.address,
      label: r.label ?? null,
      side: r.side,
      size_usd: r.sizeUsd,
      shares: r.shares,
    })),
    stats: {
      total_top20_usd: totalHolderUsd,
      concentration_top5_pct: concentrationTop5Pct,
      yes_usd: yesUsd,
      no_usd: noUsd,
      yes_pct: yesPct,
    },
  };

  const res = await (provider ?? getProvider()).complete(JSON.stringify(payload, null, 2), {
    tier: 'fast',
    systemPrompt: SYS,
    jsonOnly: true,
    timeoutMs: 90_000,
  });

  const parsed = res.ok ? extractJson<{ claims: Claim[] }>(res.text) : null;

  const validIds = new Set(citations.map(c => c.id));
  const sanitized: Claim[] = (parsed?.claims ?? []).map(c => {
    const ids = Array.isArray(c.citations) ? c.citations : [];
    const remapped = ids
      .map(id => {
        const cleaned = String(id).replace(/[\[\]]/g, '').trim();
        return validIds.has(cleaned) ? cleaned : null;
      })
      .filter((x): x is string => x != null);
    return {
      text: String(c.text ?? '').trim(),
      citations: remapped.length ? Array.from(new Set(remapped)) : ['whale·stats'],
    };
  }).filter(c => c.text.length > 0).slice(0, 4);

  const claims = sanitized.length ? sanitized : fallbackHolderClaims(rows, {
    concentrationTop5Pct,
    yesPct,
    totalHolderUsd,
  });

  return {
    agent: 'holders',
    output: { claims, citations },
    grounding,
    elapsedMs: Date.now() - started,
    ...(res.ok ? {} : { error: res.error }),
  };
}

function fallbackHolderClaims(
  rows: HolderRow[],
  stats: { concentrationTop5Pct: number; yesPct: number; totalHolderUsd: number }
): Claim[] {
  const out: Claim[] = [];
  const { concentrationTop5Pct, yesPct, totalHolderUsd } = stats;
  if (rows[0]) {
    const r = rows[0];
    const name = r.label ?? `${r.address.slice(0, 6)}…${r.address.slice(-4)}`;
    out.push({
      text: `Top holder is ${name} with $${r.sizeUsd.toLocaleString()} on ${r.side.toUpperCase()}.`,
      citations: ['whale·1'],
    });
  }
  out.push({
    text: `Top-5 holders control ${concentrationTop5Pct}% of tracked position value ($${totalHolderUsd.toLocaleString()} total).`,
    citations: ['whale·stats'],
  });
  out.push({
    text: `Money is ${yesPct}% on YES vs ${100 - yesPct}% on NO among top holders.`,
    citations: ['whale·stats'],
  });
  return out.slice(0, 4);
}
