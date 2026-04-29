// useProviderHealth — pings /api/health/providers so the right rail can
// show a green/red dot for "claude code: connected" + the user's primary
// provider. Auto-refreshes on window focus + a manual recheck() trigger.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJSON } from '../lib/client';

export type ProviderProbeResult = {
  ok: boolean;
  ms: number;
  model?: string;
  error?: string;
};

export type ProviderHealthResponse = {
  primary: string;
  checks: Record<string, ProviderProbeResult>;
  env: Record<string, boolean>;
};

export type UseProviderHealthResult = {
  health: ProviderHealthResponse | null;
  loading: boolean;
  error: string | null;
  recheck: () => void;
  /** When the last successful probe completed. */
  lastCheckedAt: number | null;
};

export function useProviderHealth(): UseProviderHealthResult {
  const [health, setHealth] = useState<ProviderHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (typeof window === 'undefined') return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const j = await apiJSON<ProviderHealthResponse>('/api/health/providers', { signal: ac.signal });
      if (ac.signal.aborted) return;
      setHealth(j);
      setLastCheckedAt(Date.now());
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    if (typeof window === 'undefined') return;
    // Re-probe when the tab regains focus — common after the user runs
    // `claude /login` in another window and tabs back here to confirm.
    const onFocus = () => { void run(); };
    window.addEventListener('focus', onFocus);
    return () => {
      abortRef.current?.abort();
      window.removeEventListener('focus', onFocus);
    };
  }, [run]);

  return { health, loading, error, recheck: run, lastCheckedAt };
}
