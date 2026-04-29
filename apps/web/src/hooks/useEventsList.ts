// useEventsList — fetches /api/events?category=...&limit=...&mode=... and
// caches the last successful payload in component state. Aborts the in-flight
// request on unmount or option change.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventSummary } from '../types';
import { apiJSON } from '../lib/client';

export type UseEventsListOpts = {
  category?: string;
  limit?: number;
  mode?: 'top' | 'contested';
};

export type UseEventsListResult = {
  events: EventSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

type EventsResponse = { events?: EventSummary[] } | EventSummary[];

function buildPath(opts: UseEventsListOpts): string {
  const params = new URLSearchParams();
  if (opts.category) params.set('category', opts.category);
  if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
  if (opts.mode) params.set('mode', opts.mode);
  const qs = params.toString();
  return qs ? `/api/events?${qs}` : '/api/events';
}

export function useEventsList(opts: UseEventsListOpts): UseEventsListResult {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const path = buildPath(opts);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);

    apiJSON<EventsResponse>(path, { signal: ac.signal })
      .then((body) => {
        if (ac.signal.aborted) return;
        const list = Array.isArray(body) ? body : Array.isArray(body.events) ? body.events : [];
        setEvents(list);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setLoading(false);
      });

    return () => {
      ac.abort();
    };
  }, [path, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { events, loading, error, refetch };
}
