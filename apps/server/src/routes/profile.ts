// GET /api/profile/:handle  → resolves Polymarket username → wallet address.
// Cached in-memory for 1 hour. Username changes are rare.

import type { Request, Response } from 'express';

const POLY_WEB = 'https://polymarket.com';
const TTL_MS = 60 * 60 * 1000;

type Cached = { wallet: string | null; cachedAt: number };
const cache = new Map<string, Cached>();

export async function profileHandler(req: Request, res: Response) {
  const handle = String(req.params['handle'] || '').trim();
  if (!handle) {
    res.status(400).json({ error: 'missing handle' });
    return;
  }

  const key = handle.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.cachedAt < TTL_MS) {
    if (!hit.wallet) {
      res.status(404).json({ error: `handle "${handle}" not found`, cached: true });
      return;
    }
    res.json({ handle, wallet: hit.wallet, cached: true });
    return;
  }

  try {
    const url = `${POLY_WEB}/api/profiles/${encodeURIComponent(handle)}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      cache.set(key, { wallet: null, cachedAt: Date.now() });
      res.status(404).json({ error: `handle "${handle}" not found`, status: r.status });
      return;
    }
    const json = (await r.json()) as { proxyWallet?: string; address?: string; name?: string };
    const wallet = (json.proxyWallet || json.address || '').toLowerCase() || null;
    cache.set(key, { wallet, cachedAt: Date.now() });
    if (!wallet) {
      res.status(404).json({ error: `handle "${handle}" has no associated wallet` });
      return;
    }
    res.json({ handle, wallet, name: json.name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `profile lookup failed: ${msg}` });
  }
}
