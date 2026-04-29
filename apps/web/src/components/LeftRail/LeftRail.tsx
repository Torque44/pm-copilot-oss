// LeftRail — event rail (320px). sticky search + category tabs + nested outcome rows.

import { useState, type ChangeEvent } from 'react';
import type { EventSummary } from '../../types';

const CATEGORIES = ['crypto', 'sports', 'politics', 'other'] as const;
type Category = (typeof CATEGORIES)[number];

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

  const source = events ?? [];
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
