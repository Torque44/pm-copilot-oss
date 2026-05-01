// useFetchedEvent — pulls the parent EventMeta for a given eventId from
// /api/event. The market panel uses this to populate its "outcomes" tab
// when the parent event isn't in the LeftRail's currently-loaded events
// list (e.g. user opened via /m/:id directly or via a recently-viewed
// chip from a different category).
//
// Skipped entirely (no fetch) when `skip` is true — the caller passes
// true if it already has the event from the in-memory events list, so
// we don't burn a round-trip.

import { useEffect, useState } from 'react';
import type { EventSummary, EventOutcome } from '../types';

type RawEvent = {
  eventId?: string;
  title?: string;
  category?: string;
  tagSlugs?: string[];
  isMultiOutcome?: boolean;
  outcomes?: Array<{
    marketId?: string;
    label?: string;
    yes?: number;
    volume24hr?: number;
  }>;
  totalVolume24hr?: number;
  endDate?: string | null;
};

function rawToSummary(raw: RawEvent): EventSummary | null {
  if (!raw.eventId || !raw.title) return null;
  const outcomes: EventOutcome[] = (raw.outcomes ?? []).flatMap((o) => {
    if (!o.marketId || typeof o.yes !== 'number') return [];
    const out: EventOutcome = {
      id: o.marketId,
      name: raw.isMultiOutcome ? (o.label || 'outcome') : 'YES',
      price: o.yes,
    };
    if (typeof o.volume24hr === 'number') out.volume24hr = o.volume24hr;
    return [out];
  });
  if (outcomes.length === 0) return null;
  outcomes.sort((a, b) => b.price - a.price);
  const summary: EventSummary = {
    id: raw.eventId,
    title: raw.title.toLowerCase(),
    category: typeof raw.category === 'string' ? raw.category : 'other',
    marketCount: outcomes.length,
    outcomes,
    isMultiOutcome: Boolean(raw.isMultiOutcome),
  };
  if (typeof raw.totalVolume24hr === 'number') summary.volume24hr = raw.totalVolume24hr;
  if (typeof raw.endDate === 'string') summary.endDate = raw.endDate;
  if (Array.isArray(raw.tagSlugs)) {
    const slugs = raw.tagSlugs.filter((x): x is string => typeof x === 'string');
    if (slugs.length > 0) summary.tagSlugs = slugs;
  }
  return summary;
}

export function useFetchedEvent(eventId: string | null, skip: boolean): EventSummary | null {
  const [event, setEvent] = useState<EventSummary | null>(null);
  useEffect(() => {
    if (!eventId || skip) {
      setEvent(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/event?id=${encodeURIComponent(eventId)}`);
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as RawEvent;
        if (cancelled) return;
        setEvent(rawToSummary(j));
      } catch {
        /* swallow — outcomes tab will just stay hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, skip]);
  return event;
}
