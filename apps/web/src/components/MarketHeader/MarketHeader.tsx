// MarketHeader — sticky market header. title + YES/NO + days + 24h vol + venue chip.

import { useState } from 'react';
import type { Market } from '../../types';

export interface MarketHeaderProps {
  market: Market;
}

export function MarketHeader({ market }: MarketHeaderProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="market-header">
      <div className="mh-row">
        <div className="mh-title-block">
          <span className="venue-chip mono">{market.venue}</span>
          <h1 className="mh-title">{market.title}</h1>
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
      <button className="mh-criteria" onClick={() => setExpanded(!expanded)}>
        <span className="mono caret">{expanded ? '▾' : '▸'}</span>
        <span className="mh-criteria-label">resolution criteria</span>
        {!expanded && (
          <span className="mh-criteria-preview">{market.criteria.slice(0, 80)}…</span>
        )}
      </button>
      {expanded && <div className="mh-criteria-full">{market.criteria}</div>}
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
