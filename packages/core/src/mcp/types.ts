// Data-feed plug-in types.
//
// A "data feed" is the surface that specialist agents call to read raw market
// data. The kernel ships built-in feeds (polymarket, kalshi-stub) and accepts
// user-registered MCP server feeds (configured in mcp.config.json).
//
// Each feed reports which venue(s) it serves. The registry routes a feed-call
// to the right loader by venue name. Specialist agents never know whether they
// are talking to the built-in HTTP wrapper or a user's MCP server.

import type {
  BookGrounding,
  HoldersGrounding,
  NewsGrounding,
  MarketMeta,
} from '../agents/types';

/** Stable venue identifier. */
export type VenueId =
  | 'polymarket'
  | 'kalshi'
  | 'limitless'
  | 'hyperliquid-predict'
  | 'drift-predict'
  | string; // user-defined venues OK

/** What this feed can answer. */
export type FeedScope = 'orderbook' | 'holders' | 'news' | 'markets' | 'prices' | 'social' | 'onchain';

/** Identity + capabilities of a data feed. */
export interface FeedDescriptor {
  /** Stable id, e.g. "polymarket-builtin" or "x-actions". */
  id: string;
  /** Venues this feed serves. A multi-venue feed may list several. */
  venues: VenueId[];
  /** What this feed answers. */
  scopes: FeedScope[];
  /** Source — built-in implementation vs user-registered MCP server. */
  source: 'builtin' | 'mcp';
  /** Human description shown in UI / CLI. */
  description?: string;
}

/** A data feed. Methods that this feed cannot answer should resolve `null`
 *  rather than throw — callers fall back to other feeds for that scope. */
export interface DataFeed {
  readonly descriptor: FeedDescriptor;

  /** Resolve a venue-specific market id to canonical MarketMeta. */
  getMarket?(marketId: string): Promise<MarketMeta | null>;

  /** Top-N markets matching a category / search filter. */
  listMarkets?(opts: { category?: string; query?: string; limit?: number }): Promise<MarketMeta[]>;

  /** Live orderbook + computed stats (mid / spread / depth / slippage). */
  getOrderbook?(market: MarketMeta): Promise<BookGrounding | null>;

  /** Top holders + concentration / side-bias. */
  getTopHolders?(market: MarketMeta): Promise<HoldersGrounding | null>;

  /** News / scheduled catalysts in a configurable window around the market. */
  getNews?(market: MarketMeta): Promise<NewsGrounding | null>;
}

/** mcp.config.json schema (loaded by the registry at startup). */
export type MCPServerConfig = {
  /** Friendly id used in logs / UI. */
  name: string;
  /** Venues this server serves. */
  venues: VenueId[];
  /** What scopes this server can fill. */
  scopes: FeedScope[];
  /** Transport. 'stdio' = local subprocess; 'http' = remote MCP HTTP endpoint. */
  transport: 'stdio' | 'http';
  /** stdio: command + args. http: url. */
  command?: string;
  args?: string[];
  url?: string;
  /** Env vars to inject into the child process (stdio only). */
  env?: Record<string, string>;
  /** Optional: tool-name mapping. Keys are DataFeed methods, values are the
   *  MCP tool name to invoke for that method. If omitted, the loader uses
   *  conventional names (e.g. method `getOrderbook` -> tool `get_orderbook`). */
  toolMap?: Partial<Record<keyof DataFeed, string>>;
};

export type MCPRegistryConfig = {
  /** Default venue when none is supplied to a brief request. */
  defaultVenue?: VenueId;
  /** User-registered MCP servers. Built-ins are always loaded. */
  mcp_servers?: MCPServerConfig[];
};
