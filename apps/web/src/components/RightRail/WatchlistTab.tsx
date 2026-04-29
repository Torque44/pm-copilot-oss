// WatchlistTab — list of starred markets.

import type { WatchItem } from '../../types';

export interface WatchlistTabProps {
  items: WatchItem[];
  onRemove: (marketId: string) => void;
}

export function WatchlistTab({ items, onRemove }: WatchlistTabProps) {
  if (items.length === 0) {
    return <div className="positions-empty mono">no watched markets yet.</div>;
  }
  return (
    <div className="watchlist-tab">
      {items.map((w) => (
        <div key={w.marketId} className="watch-row">
          <div className="watch-name">{w.title}</div>
          <div className="watch-meta">
            <span className="mono">{w.price.toFixed(2)}</span>
            <span className={`mono delta ${w.delta.startsWith('+') ? 'up' : 'down'}`}>
              {w.delta}
            </span>
            <button
              className="watch-remove"
              onClick={() => onRemove(w.marketId)}
              title="remove from watchlist"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
