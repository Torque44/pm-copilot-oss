// Built-in Polymarket data feed.
//
// Wraps lib/poly.ts (the existing Gamma + CLOB + Data API client) as a feed
// that satisfies the DataFeed interface. The specialist agents call through
// the registry; the registry routes to this loader when venue=polymarket.
//
// Computation (depth, slippage, side-bias) lives here so the agents stay
// thin and independent of which venue is providing the data.

import type { DataFeed, FeedDescriptor } from '../types';
import {
  getBook,
  getHolders,
  getPriceHistory,
  normaliseBook,
  normaliseHolders,
  depthWithin,
  simulateBuy,
} from '../../feeds/polymarket';
import type {
  BookGrounding,
  HoldersGrounding,
  NewsGrounding,
  MarketMeta,
} from '../../agents/types';

const DESCRIPTOR: FeedDescriptor = {
  id: 'polymarket-builtin',
  venues: ['polymarket'],
  scopes: ['orderbook', 'holders'],
  source: 'builtin',
  description:
    'Polymarket Gamma + CLOB + Data API (built-in). No external MCP server required.',
};

export function createPolymarketFeed(): DataFeed {
  return {
    descriptor: DESCRIPTOR,

    async getOrderbook(market: MarketMeta): Promise<BookGrounding | null> {
      try {
        // Fetch book + price history in parallel so we don't pay the round-trip
        // cost twice. Price history is best-effort: if Polymarket rejects or
        // returns empty (rare for active markets, common for newly-listed),
        // we still return a usable grounding without it.
        const [raw, history] = await Promise.all([
          getBook(market.tokenIdYes),
          getPriceHistory(market.tokenIdYes, '1d').catch(() => []),
        ]);
        const { bids, asks, spread, mid } = normaliseBook(raw);
        const slipScenarios = [100, 500, 1000];
        const slippage = slipScenarios.map((sz) => {
          const sim = simulateBuy(asks, sz);
          return { size: sz, avgPrice: sim.avgPrice, slippageC: sim.slippageC };
        });
        const topDepthUsd = mid != null ? depthWithin(bids, asks, mid, 5) : 0;
        return {
          kind: 'book',
          side: 'yes',
          // Show top-20 levels each side. Polymarket's CLOB /book endpoint
          // returns the full book; we slice for prompt-budget reasons. The
          // depth-band stats (topDepthUsd, slippage curves) still aggregate
          // the full book under the hood, so widening the visible levels
          // doesn't change the math, just gives traders more rows to read.
          bids: bids.slice(0, 20),
          asks: asks.slice(0, 20),
          spread,
          mid,
          topDepthUsd,
          slippage,
          ...(history.length ? { priceHistory: history } : {}),
        };
      } catch {
        return null;
      }
    },

    async getTopHolders(market: MarketMeta): Promise<HoldersGrounding | null> {
      try {
        // Pull 50 from upstream so after side-aware normalisation/sorting
        // we still have plenty of headroom to keep the top-20 panel honest.
        // (Polymarket /holders returns yes+no rows mixed; capping the pull
        // at 20 was the actual bottleneck that made the panel show <20.)
        const raw = await getHolders(market.conditionId, 50);
        const midYes = market.yes;
        const rows = normaliseHolders(raw, midYes, 50);
        const totalHolderUsd = rows.reduce((a, r) => a + r.sizeUsd, 0);
        const top5Usd = rows.slice(0, 5).reduce((a, r) => a + r.sizeUsd, 0);
        const concentrationTop5Pct =
          totalHolderUsd > 0 ? Math.round((top5Usd / totalHolderUsd) * 100) : 0;
        const yesUsd = rows.filter((r) => r.side === 'yes').reduce((a, r) => a + r.sizeUsd, 0);
        const noUsd = rows.filter((r) => r.side === 'no').reduce((a, r) => a + r.sizeUsd, 0);
        const yesPct = totalHolderUsd > 0 ? Math.round((yesUsd / totalHolderUsd) * 100) : 0;
        return {
          kind: 'holders',
          // Top-20 holders. Concentration ratios still use top-5 vs total,
          // but more holders surface in the panel so traders can see beyond
          // the top wallets and spot smaller-but-meaningful side flips.
          rows: rows.slice(0, 20),
          concentrationTop5Pct,
          totalHolderUsd,
          sideBias: { yesUsd, noUsd, yesPct },
        };
      } catch {
        return null;
      }
    },

    // News is provider-served (LLM web-search), not Polymarket-served.
    // The NewsAgent calls the LLM directly; no feed needed.
    async getNews(_market: MarketMeta): Promise<NewsGrounding | null> {
      return null;
    },
  };
}
