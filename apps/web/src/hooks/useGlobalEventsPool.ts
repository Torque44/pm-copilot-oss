// useGlobalEventsPool — pre-fetches the canonical category buckets in
// parallel so the LeftRail search can match across ALL categories, not
// just whichever tab is currently active.
//
// Before this, typing "f1" in the politics tab returned "no markets match"
// because useEventsList only had politics events loaded. The search filter
// was already global (LeftRail.tsx) but the data source wasn't.
//
// Returns the RAW server response shape (NOT normalised) — the caller is
// expected to feed it through the same normaliseEvents() it uses for the
// per-tab list. That keeps the two data paths producing structurally
// identical EventSummary[] downstream.

import { useEffect, useState } from 'react';
import { apiJSON } from '../lib/client';

const POOL_CATEGORIES = ['politics', 'crypto', 'sports', 'other'] as const;
const POOL_LIMIT = 80;

// Loose any[]-style typing — the consumer's normaliseEvents() does shape
// validation. We don't reimport RawEvent here to keep this hook decoupled
// from App.tsx's internal types.
type RawEventLike = unknown;
type EventsResponse = { events?: RawEventLike[] } | RawEventLike[];

export type UseGlobalEventsPoolResult = {
  /** Raw events array (NOT yet run through normaliseEvents).
   *  Passing this to the same normalisation step that the per-tab list
   *  uses produces a structurally identical EventSummary[] downstream. */
  rawPool: RawEventLike[];
  loading: boolean;
};

export function useGlobalEventsPool(): UseGlobalEventsPoolResult {
  const [rawPool, setRawPool] = useState<RawEventLike[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ac = new AbortController();
    let cancelled = false;

    Promise.all(
      POOL_CATEGORIES.map((cat) =>
        apiJSON<EventsResponse>(
          `/api/events?category=${cat}&limit=${POOL_LIMIT}&mode=contested`,
          { signal: ac.signal },
        ).then((body) => {
          const list = Array.isArray(body) ? body : Array.isArray(body.events) ? body.events : [];
          return list;
        }).catch(() => [] as RawEventLike[]),
      ),
    ).then((lists) => {
      if (cancelled) return;
      // Dedupe by event id — multi-tag events can land in multiple buckets.
      const seen = new Set<string>();
      const merged: RawEventLike[] = [];
      for (const list of lists) {
        for (const ev of list) {
          const id = (ev as { eventId?: unknown }).eventId;
          if (typeof id !== 'string' || seen.has(id)) continue;
          seen.add(id);
          merged.push(ev);
        }
      }
      setRawPool(merged);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  return { rawPool, loading };
}
