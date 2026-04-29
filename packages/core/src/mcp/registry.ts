// MCP / data-feed registry.
//
// Loads built-in feeds (Polymarket, Kalshi-stub) and any user-registered MCP
// servers from `mcp.config.json` at the repo root. Provides the venue-keyed
// lookup the agents call.
//
// Multiple feeds can serve the same (venue, scope) pair — registration order
// matters: the first feed registered for a given (venue, scope) wins, unless a
// caller explicitly asks for a specific feed by id.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DataFeed,
  FeedScope,
  MCPRegistryConfig,
  MCPServerConfig,
  VenueId,
} from './types';
import { createPolymarketFeed } from './loaders/polymarket';
import { createKalshiFeed } from './loaders/kalshi';
import { createExternalFeed } from './loaders/external';

class FeedRegistry {
  private feeds: DataFeed[] = [];
  private defaultVenue: VenueId = 'polymarket';
  private loaded = false;

  /** Idempotent loader. Reads mcp.config.json if present. */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;

    // Built-ins first — they win the (venue, scope) lookup unless a user
    // registers a feed with the same scope for the same venue ahead of them.
    this.register(createPolymarketFeed());
    this.register(createKalshiFeed());

    // User config (optional).
    const cfg = this.loadConfig();
    if (cfg?.defaultVenue) this.defaultVenue = cfg.defaultVenue;
    if (cfg?.mcp_servers?.length) {
      for (const server of cfg.mcp_servers) {
        try {
          this.register(createExternalFeed(server));
          // eslint-disable-next-line no-console
          console.log(
            `[pm-copilot] mcp server registered: ${server.name} (${server.transport}, venues=${server.venues.join(',')}, scopes=${server.scopes.join(',')})`
          );
        } catch (err: any) {
          // eslint-disable-next-line no-console
          console.warn(
            `[pm-copilot] mcp server failed to register: ${server.name} → ${err?.message ?? 'unknown'}`
          );
        }
      }
    }
  }

  /** Programmatic registration (used by built-ins and tests). */
  register(feed: DataFeed): void {
    this.feeds.push(feed);
  }

  /** Lookup the first feed that serves (venue, scope). Null if none. */
  feed(venue: VenueId, scope: FeedScope): DataFeed | null {
    this.load();
    for (const f of this.feeds) {
      if (f.descriptor.venues.includes(venue) && f.descriptor.scopes.includes(scope)) {
        return f;
      }
    }
    return null;
  }

  /** All registered feeds (for inspection / debugging). */
  list(): DataFeed[] {
    this.load();
    return this.feeds.slice();
  }

  getDefaultVenue(): VenueId {
    this.load();
    return this.defaultVenue;
  }

  private loadConfig(): MCPRegistryConfig | null {
    const candidates = this.configPaths();
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      try {
        const raw = readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw) as MCPRegistryConfig;
        // eslint-disable-next-line no-console
        console.log(`[pm-copilot] loaded mcp config: ${p}`);
        return parsed;
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(`[pm-copilot] mcp config parse failed: ${p} → ${err?.message ?? 'unknown'}`);
      }
    }
    return null;
  }

  private configPaths(): string[] {
    if (process.env.PM_COPILOT_CONFIG) return [process.env.PM_COPILOT_CONFIG];
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // lib/mcp/registry.ts → repo root is two levels up
    const repoRoot = path.join(__dirname, '..', '..');
    return [path.join(repoRoot, 'mcp.config.json')];
  }
}

export const registry = new FeedRegistry();

/** Sugar for the common pattern: get a feed for (venue, scope). */
export function feed(venue: VenueId, scope: FeedScope): DataFeed | null {
  return registry.feed(venue, scope);
}
