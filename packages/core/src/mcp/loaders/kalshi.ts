// Kalshi data feed — STUB.
//
// Kalshi parity is on the roadmap (PRD §F1). This stub satisfies the DataFeed
// interface and emits a clear "not implemented" signal so the registry can
// route around it without crashing the brief pipeline.
//
// To implement: wire to https://api.elections.kalshi.com/trade-api/v2/* with
// the user's Kalshi API key (KALSHI_API_KEY env var). Same shape as the
// Polymarket loader: getMarket / getOrderbook / getTopHolders.

import type { DataFeed, FeedDescriptor } from '../types';
import type {
  BookGrounding,
  HoldersGrounding,
  NewsGrounding,
  MarketMeta,
} from '../../agents/types';

const DESCRIPTOR: FeedDescriptor = {
  id: 'kalshi-stub',
  venues: ['kalshi'],
  scopes: ['orderbook', 'holders', 'markets'],
  source: 'builtin',
  description:
    'Kalshi v2 feed (stub — not yet implemented). See lib/mcp/loaders/kalshi.ts to wire it up.',
};

export function createKalshiFeed(): DataFeed {
  return {
    descriptor: DESCRIPTOR,

    async listMarkets(): Promise<MarketMeta[]> {
      // eslint-disable-next-line no-console
      console.warn('[pm-copilot] kalshi feed: listMarkets not implemented');
      return [];
    },

    async getOrderbook(_market: MarketMeta): Promise<BookGrounding | null> {
      // eslint-disable-next-line no-console
      console.warn('[pm-copilot] kalshi feed: getOrderbook not implemented');
      return null;
    },

    async getTopHolders(_market: MarketMeta): Promise<HoldersGrounding | null> {
      // Kalshi does not expose per-trader holder lists publicly; stub stays empty.
      return null;
    },

    async getNews(_market: MarketMeta): Promise<NewsGrounding | null> {
      return null;
    },
  };
}
