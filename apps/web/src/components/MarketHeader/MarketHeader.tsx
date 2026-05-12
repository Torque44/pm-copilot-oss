// MarketHeader — sticky market header. title + YES/NO + days + 24h vol + venue chip.
//
// The resolution criteria expander used to live here too, but the news
// panel already has a dedicated "resolution" tab — duplicating the same
// copy at the top wastes vertical space. Header now stays compact; users
// hit ⌘3 → resolution tab when they want the fine print.
//
// Resolved markets get a slate-amber banner above the title row so the
// trader knows AT A GLANCE the market they're briefing already paid out.

import type { Market } from '../../types';

export interface MarketHeaderProps {
  market: Market;
  /** Whether this market is currently saved in the watchlist. Drives the
   *  filled vs outline state of the watchlist button. */
  inWatchlist?: boolean;
  /** Click handler for the watchlist toggle. When omitted the button is
   *  hidden so MarketHeader stays drop-in-compatible with old call sites. */
  onToggleWatchlist?: () => void;
}

export function MarketHeader({ market, inWatchlist, onToggleWatchlist }: MarketHeaderProps) {
  const resolved = market.resolvedAt;
  // Outcome inference: whichever side is closer to 1.0 is the resolved outcome.
  // Gamma sets the winning side to exactly 1.0 and the losing side to 0.0 on
  // closed markets — but we use comparison rather than equality to survive
  // any future drift in payout encoding.
  const finalOutcome: 'YES' | 'NO' | null = resolved && market.yes != null && market.no != null
    ? (market.yes >= market.no ? 'YES' : 'NO')
    : null;
  const finalPrice = finalOutcome === 'YES' ? market.yes : finalOutcome === 'NO' ? market.no : null;
  const resolvedHuman = resolved ? formatResolvedDate(resolved) : '';

  return (
    <div className="market-header">
      {resolved && (
        <div className="mh-resolved-banner mono">
          <span className="mh-resolved-label">resolved · {resolvedHuman}</span>
          {finalOutcome && finalPrice != null && (
            <span className={`mh-resolved-outcome ${finalOutcome.toLowerCase()}`}>
              final {finalOutcome} @ ${finalPrice.toFixed(2)}
            </span>
          )}
        </div>
      )}
      <div className="mh-row">
        <div className="mh-title-block">
          <span className="venue-chip mono">{market.venue}</span>
          <h1 className="mh-title">{market.title}</h1>
          {market.slug && (
            <a
              className="mh-trade-btn mono"
              href={`https://polymarket.com/event/${market.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              title="open this market on polymarket.com"
            >
              trade on polymarket ↗
            </a>
          )}
          {!resolved && onToggleWatchlist && (
            <button
              type="button"
              className={`mh-watch-btn mono ${inWatchlist ? 'on' : ''}`}
              onClick={onToggleWatchlist}
              title={inWatchlist ? 'remove from watchlist (⌘B)' : 'add to watchlist (⌘B)'}
              aria-label={inWatchlist ? 'remove from watchlist' : 'add to watchlist'}
            >
              {inWatchlist ? '★ watching' : '☆ watch'}
            </button>
          )}
        </div>
        {!market.multi && market.yes !== undefined && market.no !== undefined && (
          <div className="mh-prices">
            <div className="mh-price-block">
              <span className="mh-side mono">YES</span>
              <span className="mh-price mono yes">{market.yes.toFixed(2)}</span>
            </div>
            <div className="mh-price-block">
              <span className="mh-side mono">NO</span>
              <span className="mh-price mono no">{market.no.toFixed(2)}</span>
            </div>
          </div>
        )}
        <div className="mh-meta">
          <div className="mh-meta-block">
            <div className="mh-meta-label mono">resolves in</div>
            <div className="mh-meta-value mono">{market.resolveIn}</div>
          </div>
          <div className="mh-meta-block">
            <div className="mh-meta-label mono">24h vol</div>
            <div className="mh-meta-value mono">{market.vol24h}</div>
          </div>
        </div>
      </div>
      {market.multi && market.outcomes && (
        <div className="mh-multi">
          {market.outcomes.map((o, i) => (
            <div key={i} className="multi-row">
              <span className="multi-name">{o.name}</span>
              <span className="multi-bar">
                <span className="multi-bar-fill" style={{ width: `${o.yes * 100}%` }} />
              </span>
              <span className="mono yes">{o.yes.toFixed(2)}</span>
              <span className="mono no">{o.no.toFixed(2)}</span>
            </div>
          ))}
          {market.moreCount !== undefined && market.moreCount > 0 && (
            <button className="multi-more">+{market.moreCount} more outcomes</button>
          )}
        </div>
      )}
    </div>
  );
}

function formatResolvedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase();
}
