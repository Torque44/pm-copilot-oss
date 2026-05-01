// LeftRail — event rail (320px). Sticky search + category tabs + event cards.
//
// Cards show the event title, a countdown badge, and a single-line price
// strip — for binary events that's a YES/NO bar; for multi-outcome events,
// the top-3 candidates with prices, plus a "+N more" expander.
//
// Click anywhere on a binary card → load that market.
// Click an outcome row in a multi card → load that specific outcome.
// Click "+N more" → expand the multi card inline (no navigation).

import { useMemo, useState, type ChangeEvent } from 'react';
import type { EventOutcome, EventSummary } from '../../types';
import { formatRelativeDuration } from '../../lib/format';

// The tab list. Each tab has a `slug` we send to /api/events as the
// category param, and a display label. The first four are the canonical
// gamma tag_slug values (also map 1:1 to the agent pipeline's Category
// enum). The rest are popular Polymarket tag slugs surveyed from active
// events — adding a tab here just means "show events whose tags include
// this slug."
const CATEGORIES = [
  { slug: 'politics', label: 'politics' },
  { slug: 'crypto', label: 'crypto' },
  { slug: 'sports', label: 'sports' },
  { slug: 'geopolitics', label: 'geopolitics' },
  { slug: 'tech', label: 'tech' },
  { slug: 'iran', label: 'iran' },
  { slug: 'middle-east', label: 'middle east' },
  { slug: 'elections', label: 'elections' },
  { slug: 'pop-culture', label: 'pop culture' },
  { slug: 'economy', label: 'economy' },
] as const;
type Category = (typeof CATEGORIES)[number]['slug'];

const TOP_CANDIDATES_COLLAPSED = 3;

function fmtVol(v: number | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

interface BinaryStripProps {
  outcome: EventOutcome;
  selected: boolean;
}

function BinaryStrip({ outcome, selected }: BinaryStripProps) {
  const yesPct = Math.round(outcome.price * 100);
  return (
    <div className={`event-strip binary ${selected ? 'selected' : ''}`}>
      <div className="event-bar">
        <span
          className="event-bar-fill yes"
          style={{ width: `${Math.max(2, Math.min(98, yesPct))}%` }}
        />
      </div>
      <span className="event-strip-pct mono yes">{yesPct}%</span>
    </div>
  );
}

interface MultiRowProps {
  outcome: EventOutcome;
  selected: boolean;
  onSelect: () => void;
}

function MultiRow({ outcome, selected, onSelect }: MultiRowProps) {
  const yesPct = Math.round(outcome.price * 100);
  return (
    <button
      type="button"
      className={`multi-row-row ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <span className="multi-row-name">{outcome.name}</span>
      <span className="multi-row-bar">
        <span
          className="multi-row-bar-fill"
          style={{ width: `${Math.max(2, Math.min(98, yesPct))}%` }}
        />
      </span>
      <span className="multi-row-pct mono">{yesPct}%</span>
    </button>
  );
}

interface EventCardProps {
  event: EventSummary;
  selectedId: string | null;
  onSelect: (marketId: string) => void;
}

function EventCard({ event, selectedId, onSelect }: EventCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isMulti = event.isMultiOutcome && event.outcomes.length > 1;
  const top = event.outcomes[0];
  if (!top) return null;

  const countdown = formatRelativeDuration(event.endDate ?? null);
  const vol = fmtVol(event.volume24hr);
  const containsSelected = event.outcomes.some((o) => o.id === selectedId);

  // Binary cards: whole card is a button → navigate to top outcome.
  if (!isMulti) {
    const isSelected = top.id === selectedId;
    return (
      <button
        type="button"
        className={`event-card binary ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelect(top.id)}
      >
        <div className="event-card-head">
          <span className="event-card-title">{event.title}</span>
          <span className="event-card-meta mono">
            {countdown !== '—' && <span className="event-card-when">{countdown}</span>}
            {vol && <span className="event-card-vol">{vol}</span>}
          </span>
        </div>
        <BinaryStrip outcome={top} selected={isSelected} />
      </button>
    );
  }

  // Multi cards: top-3 collapsed, expander reveals the rest.
  const visibleOutcomes = expanded
    ? event.outcomes
    : event.outcomes.slice(0, TOP_CANDIDATES_COLLAPSED);
  const hidden = event.outcomes.length - visibleOutcomes.length;

  return (
    <div className={`event-card multi ${containsSelected ? 'selected' : ''}`}>
      <div className="event-card-head">
        <span className="event-card-title">{event.title}</span>
        <span className="event-card-meta mono">
          {countdown !== '—' && <span className="event-card-when">{countdown}</span>}
          {vol && <span className="event-card-vol">{vol}</span>}
        </span>
      </div>
      <div className="event-card-body multi">
        {visibleOutcomes.map((o) => (
          <MultiRow
            key={o.id}
            outcome={o}
            selected={o.id === selectedId}
            onSelect={() => onSelect(o.id)}
          />
        ))}
        {!expanded && hidden > 0 && (
          <button
            type="button"
            className="multi-row-more mono"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
          >
            +{hidden} more
          </button>
        )}
        {expanded && event.outcomes.length > TOP_CANDIDATES_COLLAPSED && (
          <button
            type="button"
            className="multi-row-more mono"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
            }}
          >
            collapse
          </button>
        )}
      </div>
    </div>
  );
}

export interface LeftRailProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  events?: EventSummary[];
  onCategoryChange?: (cat: string) => void;
  loading?: boolean;
}

export function LeftRail({
  selectedId,
  onSelect,
  collapsed,
  events,
  onCategoryChange,
  loading = false,
}: LeftRailProps) {
  const [cat, setCat] = useState<Category>('politics');
  const [q, setQ] = useState('');

  const source = events ?? [];

  // Filter pipeline:
  //   1. tag/category match — for the four canonical buckets we match on
  //      `e.category` (the bucket the agent pipeline assigned). For any
  //      other tab we match on `tagSlugs` (Polymarket's actual taxonomy).
  //   2. text search on title or any outcome label.
  //   3. sort by 24h volume desc.
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const isCanonical = cat === 'politics' || cat === 'crypto' || cat === 'sports';
    return source
      .filter((e) => {
        if (isCanonical) return e.category === cat;
        return Array.isArray(e.tagSlugs) && e.tagSlugs.includes(cat);
      })
      .filter((e) => {
        if (!ql) return true;
        if (e.title.includes(ql)) return true;
        return e.outcomes.some((o) => o.name.toLowerCase().includes(ql));
      })
      .sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0));
  }, [source, cat, q]);

  if (collapsed) return null;

  const handleCat = (next: Category) => {
    setCat(next);
    onCategoryChange?.(next);
  };

  return (
    <aside className="rail-left">
      <div className="rail-sticky">
        <div className="search-box">
          <span className="search-icon">⌕</span>
          <input
            className="search-input"
            placeholder="search markets"
            value={q}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          />
          <span className="kbd">⌘K</span>
        </div>
        <div className="cat-tabs">
          {CATEGORIES.map((c) => (
            <button
              key={c.slug}
              className={`cat-tab ${c.slug === cat ? 'active' : ''}`}
              onClick={() => handleCat(c.slug)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="event-list">
        {filtered.map((e) => (
          <EventCard
            key={e.id}
            event={e}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
        {filtered.length === 0 && (
          <div className="empty-rail">
            {loading
              ? 'loading polymarket events…'
              : source.length === 0
                ? 'no events loaded yet.'
                : `no ${cat} markets match.`}
          </div>
        )}
      </div>
    </aside>
  );
}
