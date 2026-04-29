// MarketAgent — reads the orderbook (via the venue's data feed in the MCP
// registry), then asks the LLM provider for 2–4 plain-English claims about
// price, spread, and liquidity. The agent never talks to a venue API directly:
// the registry routes orderbook reads to the right feed (built-in Polymarket
// or a user-supplied MCP server).

import { feed as feedFor } from '../mcp/registry';
import { getProvider } from '../providers/index';
import { extractJson, type LLMProvider } from '../providers/types';
import type {
  AgentContext,
  AgentResult,
  BookGrounding,
  Citation,
  Claim,
  SectionOut,
} from './types';

const SYS = `You are a prediction-market microstructure analyst.

Given a JSON snapshot of an orderbook (bids, asks, computed stats), output 2–4 SHORT claims about price, spread, and liquidity.

Rules:
- Every claim MUST reference a specific number from the snapshot.
- Every claim ends with one or more citation IDs in the form [book·N] where N corresponds to the book level referenced (1 = top-of-book, 2 = second level, etc).
- Do not speculate. Do not mention "volatility" unless the snapshot shows it.
- If bids or asks are empty, say so and stop.

Return JSON with this exact shape:
{
  "claims": [
    { "text": "<claim with [book·N] citations>", "citations": ["book·1", "book·3"] }
  ]
}`;

export async function runMarketAgent(
  ctx: AgentContext,
  provider?: LLMProvider,
): Promise<AgentResult> {
  const started = Date.now();
  const { market, emit } = ctx;

  const venue = market.venue ?? 'polymarket';
  const dataFeed = feedFor(venue, 'orderbook');

  if (!dataFeed?.getOrderbook) {
    return {
      agent: 'market',
      output: {
        claims: [{ text: `No orderbook feed registered for venue "${venue}".`, citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      error: `no orderbook feed for venue ${venue}`,
    };
  }

  let grounding: BookGrounding | null;
  try {
    grounding = await dataFeed.getOrderbook(market);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return {
      agent: 'market',
      output: {
        claims: [{
          text: `Orderbook fetch failed: ${msg}.`,
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
      agent: 'market',
      output: {
        claims: [{ text: `Orderbook unavailable from feed "${dataFeed.descriptor.id}".`, citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      error: 'feed returned null',
    };
  }

  const { bids, asks, spread, mid, topDepthUsd, slippage } = grounding;

  // Emit grounding to the rail immediately (before LLM call).
  emit({ t: 'agent:data', agent: 'market', grounding });

  // Build citations up-front — one per top-5 bid and ask.
  const citations: Citation[] = [];
  bids.slice(0, 5).forEach((b, i) => {
    citations.push({
      id: `book·bid${i + 1}`,
      kind: 'book',
      label: `book·${i + 1}b`,
      payload: { side: 'bid', rank: i + 1, price: b.price, size: b.size },
    });
  });
  asks.slice(0, 5).forEach((a, i) => {
    citations.push({
      id: `book·ask${i + 1}`,
      kind: 'book',
      label: `book·${i + 1}a`,
      payload: { side: 'ask', rank: i + 1, price: a.price, size: a.size },
    });
  });
  citations.push({
    id: 'book·stats',
    kind: 'book',
    label: 'book·stats',
    payload: { spread, mid, topDepthUsd, slippage },
  });

  if (!bids.length && !asks.length) {
    return {
      agent: 'market',
      output: {
        claims: [{
          text: 'No resting liquidity on either side — book is empty.',
          citations: ['book·stats'],
        }],
        citations,
      },
      grounding,
      elapsedMs: Date.now() - started,
    };
  }

  const userPayload = JSON.stringify({
    market_title: market.title,
    bids_top5: bids.slice(0, 5),
    asks_top5: asks.slice(0, 5),
    spread,
    mid,
    top_depth_usd_within_5c: topDepthUsd,
    slippage_for_usd: slippage,
  }, null, 2);

  const res = await (provider ?? getProvider()).complete(userPayload, {
    tier: 'fast',
    systemPrompt: SYS,
    jsonOnly: true,
    // 90s: subprocess + concurrent contention can push haiku-class calls to 30-60s.
    timeoutMs: 90_000,
  });

  const parsed = res.ok ? extractJson<{ claims: Claim[] }>(res.text) : null;

  const claims: Claim[] = parsed?.claims?.length
    ? sanitizeClaims(parsed.claims, citations)
    : fallbackMarketClaims(bids, asks, spread, mid, topDepthUsd);

  const output: SectionOut = { claims, citations };

  return {
    agent: 'market',
    output,
    grounding,
    elapsedMs: Date.now() - started,
    ...(res.ok ? {} : { error: res.error }),
  };
}

function sanitizeClaims(raw: Claim[], citations: Citation[]): Claim[] {
  const validIds = new Set(citations.map(c => c.id));
  const mapAlias = (id: string): string | null => {
    if (validIds.has(id)) return id;
    const m = id.match(/^book[\s·-]?(\d+)$/i);
    if (m) {
      const bidId = `book·bid${m[1]}`;
      if (validIds.has(bidId)) return bidId;
    }
    const m2 = id.match(/^book[\s·-]?(\d+)([ab])$/i);
    if (m2) {
      const prefix = m2[2] === 'a' ? 'ask' : 'bid';
      const id2 = `book·${prefix}${m2[1]}`;
      if (validIds.has(id2)) return id2;
    }
    return null;
  };
  return raw.map(c => {
    const normIds = Array.isArray(c.citations) ? c.citations : [];
    const remapped = normIds
      .map(id => mapAlias(String(id).replace(/[\[\]]/g, '').trim()))
      .filter((x): x is string => x != null);
    const finalIds = remapped.length ? Array.from(new Set(remapped)) : ['book·stats'];
    return {
      text: String(c.text ?? '').trim(),
      citations: finalIds,
    };
  }).filter(c => c.text.length > 0).slice(0, 4);
}

function fallbackMarketClaims(
  bids: BookGrounding['bids'],
  asks: BookGrounding['asks'],
  spread: number | null,
  mid: number | null,
  topDepthUsd: number
): Claim[] {
  const out: Claim[] = [];
  if (mid != null && spread != null) {
    out.push({
      text: `Mid is ${(mid * 100).toFixed(1)}¢ with a ${(spread * 100).toFixed(1)}¢ spread.`,
      citations: ['book·stats'],
    });
  }
  if (topDepthUsd > 0) {
    out.push({
      text: `Approximately $${topDepthUsd.toLocaleString()} resting within ±5¢ of mid.`,
      citations: ['book·stats'],
    });
  }
  if (bids[0]) {
    out.push({
      text: `Top bid is ${(bids[0].price * 100).toFixed(1)}¢ for ${bids[0].size.toFixed(0)} shares.`,
      citations: ['book·bid1'],
    });
  }
  if (asks[0]) {
    out.push({
      text: `Top ask is ${(asks[0].price * 100).toFixed(1)}¢ for ${asks[0].size.toFixed(0)} shares.`,
      citations: ['book·ask1'],
    });
  }
  return out.slice(0, 4);
}
