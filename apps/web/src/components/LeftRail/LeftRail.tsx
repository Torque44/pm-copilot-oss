// LeftRail — event rail (320px). sticky search + category tabs + nested outcome rows.

import { useState, type ChangeEvent } from 'react';
import type { EventSummary } from '../../types';

const CATEGORIES = ['crypto', 'sports', 'politics', 'other'] as const;
type Category = (typeof CATEGORIES)[number];

const DEFAULT_EVENTS: EventSummary[] = [
  {
    id: 'evt-btc100k',
    category: 'crypto',
    title: 'btc at $100k by eoy 2026',
    marketCount: 1,
    outcomes: [
      { id: 'btc100k', name: 'YES', price: 0.62 },
      { id: 'btc100k-no', name: 'NO', price: 0.39 },
    ],
  },
  {
    id: 'evt-ethbtc',
    category: 'crypto',
    title: 'eth/btc ratio < 0.04 by jul 2026',
    marketCount: 1,
    outcomes: [
      { id: 'ethbtc', name: 'YES', price: 0.34 },
      { id: 'ethbtc-no', name: 'NO', price: 0.67 },
    ],
  },
  {
    id: 'evt-sol400',
    category: 'crypto',
    title: 'sol > $400 in q3 2026',
    marketCount: 1,
    outcomes: [
      { id: 'sol400', name: 'YES', price: 0.18 },
      { id: 'sol400-no', name: 'NO', price: 0.83 },
    ],
  },
  {
    id: 'evt-dem2028',
    category: 'politics',
    title: '2028 democratic nominee',
    marketCount: 3,
    outcomes: [
      { id: 'dem2028', name: 'newsom', price: 0.21 },
      { id: 'dem-pete', name: 'buttigieg', price: 0.14 },
      { id: 'dem-gw', name: 'whitmer', price: 0.11 },
    ],
  },
  {
    id: 'evt-fed',
    category: 'politics',
    title: 'next fed rate decision',
    marketCount: 2,
    outcomes: [
      { id: 'fed-cut', name: '25bp cut', price: 0.71 },
      { id: 'fed-hold', name: 'hold', price: 0.27 },
    ],
  },
  {
    id: 'evt-sb',
    category: 'sports',
    title: 'super bowl LX winner',
    marketCount: 2,
    outcomes: [
      { id: 'sb-kc', name: 'kansas city', price: 0.22 },
      { id: 'sb-buf', name: 'buffalo', price: 0.18 },
    ],
  },
];

export interface LeftRailProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  events?: EventSummary[];
  onCategoryChange?: (cat: string) => void;
}

export function LeftRail({
  selectedId,
  onSelect,
  collapsed,
  events,
  onCategoryChange,
}: LeftRailProps) {
  const [cat, setCat] = useState<Category>('crypto');
  const [q, setQ] = useState('');

  if (collapsed) return null;

  // If `events` is omitted entirely, fall back to demo data (used by the
  // design-bundle preview). When the host passes an array — even empty — we
  // trust it and surface "no markets match" instead of demo data, so the UI
  // doesn't lie about polymarket connectivity.
  const source = events ?? DEFAULT_EVENTS;
  const filtered = source
    .filter((e) => e.category === cat)
    .filter((e) => !q || e.title.toLowerCase().includes(q.toLowerCase()));

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
              key={c}
              className={`cat-tab ${c === cat ? 'active' : ''}`}
              onClick={() => handleCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="event-list">
        {filtered.map((e) => (
          <div key={e.id} className="event-group">
            <div className="event-name">{e.title}</div>
            {e.outcomes.map((o) => (
              <button
                key={o.id}
                className={`outcome-row ${o.id === selectedId ? 'selected' : ''}`}
                onClick={() => onSelect(o.id)}
              >
                <span className="outcome-name">{o.name}</span>
                <span className="outcome-price mono">{o.price.toFixed(2)}</span>
              </button>
            ))}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="empty-rail">
            {source.length === 0
              ? 'loading polymarket events…'
              : `no ${cat} markets match.`}
          </div>
        )}
      </div>
    </aside>
  );
}
