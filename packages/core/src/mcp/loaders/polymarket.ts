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
        const raw = await getBook(market.tokenIdYes);
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
          bids: bids.slice(0, 5),
          asks: asks.slice(0, 5),
          spread,
          mid,
          topDepthUsd,
          slippage,
        };
      } catch {
        return null;
      }
    },

    async getTopHolders(market: MarketMeta): Promise<HoldersGrounding | null> {
      try {
        const raw = await getHolders(market.conditionId, 20);
        const midYes = market.yes;
        const rows = normaliseHolders(raw, midYes, 20);
        const totalHolderUsd = rows.reduce((a, r) => a + r.sizeUsd, 0);
        const top5Usd = rows.slice(0, 5).reduce((a, r) => a + r.sizeUsd, 0);
        const concentrationTop5Pct =
          totalHolderUsd > 0 ? Math.round((top5Usd / totalHolderUsd) * 100) : 0;
        const yesUsd = rows.filter((r) => r.side === 'yes').reduce((a, r) => a + r.sizeUsd, 0);
        const noUsd = rows.filter((r) => r.side === 'no').reduce((a, r) => a + r.sizeUsd, 0);
        const yesPct = totalHolderUsd > 0 ? Math.round((yesUsd / totalHolderUsd) * 100) : 0;
        return {
          kind: 'holders',
          rows: rows.slice(0, 10),
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
