// GET /api/positions?wallet=<0x or username>
//
// Resolves a Polymarket username → 0x wallet via /api/profile/{handle},
// then fetches open positions from data-api.polymarket.com. Server-cached
// per resolved-wallet for POSITIONS_CACHE_TTL_MS (default 60s).

import type { Request, Response } from 'express';

const POLY_DATA = 'https://data-api.polymarket.com';
const POLY_WEB = 'https://polymarket.com';

const TTL_MS = Number(process.env['POSITIONS_CACHE_TTL_MS'] || 60_000);

type PositionRow = {
  conditionId: string;
  market: string; // marketId
  asset: string; // tokenId
  outcomeIndex: number; // 0 = YES, 1 = NO (Polymarket convention)
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  endDate: string | null;
  title: string;
  outcome: string;
};

type Cached = { rows: PositionRow[]; resolved: string; cachedAt: number };
const cache = new Map<string, Cached>();

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

async function resolveWallet(input: string): Promise<string | null> {
  if (ADDRESS_RE.test(input)) return input.toLowerCase();
  // try profile lookup
  try {
    const url = `${POLY_WEB}/api/profiles/${encodeURIComponent(input)}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const json = (await r.json()) as { proxyWallet?: string; address?: string };
    return (json.proxyWallet || json.address || '').toLowerCase() || null;
  } catch {
    return null;
  }
}

async function fetchPositions(wallet: string): Promise<PositionRow[]> {
  const url = `${POLY_DATA}/positions?user=${wallet}&limit=100&sortBy=CURRENT&sortDirection=DESC`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`polymarket positions HTTP ${r.status}`);
  const json = (await r.json()) as PositionRow[];
  return Array.isArray(json) ? json : [];
}

export async function positionsHandler(req: Request, res: Response) {
  const input = String(req.query['wallet'] || '').trim();
  if (!input) {
    res.status(400).json({ error: 'missing wallet query param' });
    return;
  }

  const resolved = await resolveWallet(input);
  if (!resolved) {
    res.status(404).json({ error: `could not resolve "${input}" to a Polymarket wallet` });
    return;
  }

  const hit = cache.get(resolved);
  if (hit && Date.now() - hit.cachedAt < TTL_MS) {
    res.json({
      input,
      wallet: hit.resolved,
      positions: hit.rows,
      cachedAt: hit.cachedAt,
      stale: false,
    });
    return;
  }

  try {
    const rows = await fetchPositions(resolved);
    const cached: Cached = { rows, resolved, cachedAt: Date.now() };
    cache.set(resolved, cached);
    res.json({ input, wallet: resolved, positions: rows, cachedAt: cached.cachedAt, stale: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Serve stale on failure if we have any
    if (hit) {
      res.json({ input, wallet: hit.resolved, positions: hit.rows, cachedAt: hit.cachedAt, stale: true, error: msg });
    } else {
      res.status(502).json({ error: `polymarket fetch failed: ${msg}` });
    }
  }
}
