// usePositions — GET /api/positions?wallet=<addr|handle>.
//
// Caches the last good response so refetch() doesn't flash an empty list while
// the network round-trip is in flight. Aborts on unmount / wallet change.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Position } from '../types';
import { apiJSON } from '../lib/client';

export type UsePositionsResult = {
  positions: Position[];
  resolvedWallet: string | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  refetch: () => void;
};

type PositionsResponse = {
  wallet?: string;
  positions?: Position[];
  cachedAt?: number;
  stale?: boolean;
  error?: string;
};

export function usePositions(wallet: string | null): UsePositionsResult {
  const [positions, setPositions] = useState<Position[]>([]);
  const [resolvedWallet, setResolvedWallet] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [nonce, setNonce] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!wallet) {
      // Clearing the wallet should flush state — no cached carry-over.
      abortRef.current?.abort();
      setPositions([]);
      setResolvedWallet(null);
      setLoading(false);
      setError(null);
      setStale(false);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);

    const path = `/api/positions?wallet=${encodeURIComponent(wallet)}`;
    apiJSON<PositionsResponse>(path, { signal: ac.signal })
      .then((body) => {
        if (ac.signal.aborted) return;
        const list = Array.isArray(body.positions) ? body.positions : [];
        setPositions(list); // overwrite — server returns the canonical list
        setResolvedWallet(body.wallet ?? null);
        setStale(Boolean(body.stale));
        setLoading(false);
        if (body.error) setError(body.error);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setLoading(false);
        // intentionally keep previous `positions` so UI doesn't flash empty
      });

    return () => {
      ac.abort();
    };
  }, [wallet, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { positions, resolvedWallet, loading, error, stale, refetch };
}
