// Generic external MCP-server loader.
//
// Connects to a user-registered MCP server (per the Model Context Protocol
// spec) over either stdio (local subprocess) or HTTP. Maps DataFeed methods to
// MCP tool calls.
//
// Implementation note. The MCP wire protocol is fully specced; this file
// implements just enough of it to satisfy DataFeed:
//
//   - JSON-RPC 2.0 over stdio (newline-framed) or HTTP POST
//   - methods: tools/list, tools/call
//   - one tool call per DataFeed method
//
// Tool naming convention (overridable via toolMap in mcp.config.json):
//   getMarket      → get_market
//   listMarkets    → list_markets
//   getOrderbook   → get_orderbook
//   getTopHolders  → get_top_holders
//   getNews        → get_news
//
// The result envelope from a tool call is expected to be a JSON object
// matching the corresponding DataFeed return type. The loader trusts the
// server's shape and does not re-validate (servers misbehaving will surface
// as malformed grounding in the rail, which is the desired feedback loop).

import { spawn, type ChildProcess } from 'node:child_process';
import type { DataFeed, FeedDescriptor, MCPServerConfig } from '../types';
import type {
  BookGrounding,
  HoldersGrounding,
  NewsGrounding,
  MarketMeta,
} from '../../agents/types';

type RpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
};

type RpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const DEFAULT_TOOLS: Record<string, string> = {
  getMarket: 'get_market',
  listMarkets: 'list_markets',
  getOrderbook: 'get_orderbook',
  getTopHolders: 'get_top_holders',
  getNews: 'get_news',
};

class StdioTransport {
  private child: ChildProcess | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, (msg: RpcResponse) => void>();

  constructor(private cfg: MCPServerConfig) {}

  start(): void {
    if (this.child) return;
    this.child = spawn(this.cfg.command ?? 'echo', this.cfg.args ?? [], {
      env: { ...process.env, ...(this.cfg.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as RpcResponse;
          const handler = this.pending.get(msg.id);
          if (handler) {
            this.pending.delete(msg.id);
            handler(msg);
          }
        } catch {
          /* ignore non-JSON line */
        }
      }
    });
    this.child.on('exit', () => {
      this.child = null;
    });
  }

  async call(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    this.start();
    if (!this.child) throw new Error(`mcp ${this.cfg.name}: subprocess failed to start`);
    const id = this.nextId++;
    const req: RpcRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp ${this.cfg.name}: ${method} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, (resp) => {
        clearTimeout(timer);
        if (resp.error) reject(new Error(resp.error.message));
        else resolve(resp.result);
      });
      this.child!.stdin?.write(JSON.stringify(req) + '\n');
    });
  }

  stop(): void {
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
      this.child = null;
    }
  }
}

class HttpTransport {
  private nextId = 1;
  constructor(private cfg: MCPServerConfig) {}

  async call(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (!this.cfg.url) throw new Error(`mcp ${this.cfg.name}: missing url for http transport`);
    const req: RpcRequest = { jsonrpc: '2.0', id: this.nextId++, method, params };
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(this.cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      clearTimeout(killer);
      const data = (await r.json()) as RpcResponse;
      if (data.error) throw new Error(data.error.message);
      return data.result;
    } catch (err: any) {
      clearTimeout(killer);
      throw new Error(err?.message ?? 'http transport failed');
    }
  }
}

export function createExternalFeed(cfg: MCPServerConfig): DataFeed {
  const transport =
    cfg.transport === 'http' ? new HttpTransport(cfg) : new StdioTransport(cfg);

  const toolFor = (method: keyof DataFeed): string => {
    return cfg.toolMap?.[method] ?? DEFAULT_TOOLS[method as string] ?? (method as string);
  };

  const callTool = async (method: keyof DataFeed, args: unknown) => {
    try {
      const res = (await transport.call('tools/call', {
        name: toolFor(method),
        arguments: args,
      })) as { content?: { type: string; text?: string }[] } | unknown;
      // MCP tools/call returns { content: [{ type:'text', text: '<json>' }] }.
      // We accept either that envelope or a direct JSON object.
      if (
        res &&
        typeof res === 'object' &&
        'content' in (res as any) &&
        Array.isArray((res as any).content)
      ) {
        const blocks = (res as any).content as { type: string; text?: string }[];
        const t = blocks
          .map((b) => (b.type === 'text' ? b.text ?? '' : ''))
          .join('')
          .trim();
        if (!t) return null;
        try {
          return JSON.parse(t);
        } catch {
          return null;
        }
      }
      return res;
    } catch {
      return null;
    }
  };

  const descriptor: FeedDescriptor = {
    id: cfg.name,
    venues: cfg.venues,
    scopes: cfg.scopes,
    source: 'mcp',
    description: `External MCP server "${cfg.name}" (${cfg.transport}).`,
  };

  const feed: DataFeed = { descriptor };

  if (cfg.scopes.includes('markets')) {
    feed.getMarket = async (marketId) =>
      (await callTool('getMarket', { marketId })) as MarketMeta | null;
    feed.listMarkets = async (opts) =>
      ((await callTool('listMarkets', opts)) as MarketMeta[] | null) ?? [];
  }
  if (cfg.scopes.includes('orderbook')) {
    feed.getOrderbook = async (market) =>
      (await callTool('getOrderbook', { market })) as BookGrounding | null;
  }
  if (cfg.scopes.includes('holders') || cfg.scopes.includes('onchain')) {
    feed.getTopHolders = async (market) =>
      (await callTool('getTopHolders', { market })) as HoldersGrounding | null;
  }
  if (cfg.scopes.includes('news') || cfg.scopes.includes('social')) {
    feed.getNews = async (market) =>
      (await callTool('getNews', { market })) as NewsGrounding | null;
  }

  return feed;
}
