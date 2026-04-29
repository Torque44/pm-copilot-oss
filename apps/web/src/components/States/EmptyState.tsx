// EmptyState — shown when no market is selected.

export interface EmptyStateRecent {
  marketId: string;
  name: string;
  meta: string;
  cat: string;
}

export interface EmptyStateProps {
  recents?: EmptyStateRecent[];
  onPaste?: (url: string) => void;
  onPickRecent?: (marketId: string) => void;
}

export function EmptyState({ recents, onPaste, onPickRecent }: EmptyStateProps) {
  const data = recents ?? [];
  return (
    <div className="empty-state">
      <div className="empty-card">
        <div className="empty-title">no market selected</div>
        <div className="empty-sub">
          pick a market on the left, or paste a polymarket / kalshi url.
        </div>
        <input
          className="empty-paste"
          placeholder="https://polymarket.com/event/…"
          onChange={(e) => onPaste?.(e.target.value)}
        />
      </div>
      {data.length > 0 && (
        <div className="empty-recents">
          <div className="empty-recents-title mono">recently viewed</div>
          <div className="empty-recents-grid">
            {data.map((r) => (
              <button
                key={r.marketId}
                className="recent-card"
                onClick={() => onPickRecent?.(r.marketId)}
              >
                <span className="recent-cat mono">{r.cat}</span>
                <span className="recent-name">{r.name}</span>
                <span className="recent-meta mono">{r.meta}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
