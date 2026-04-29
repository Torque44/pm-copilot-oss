// PositionStrip — auto-renders above VerdictBand when positions match the current marketId.

import type { Position } from '../../types';

export interface PositionStripProps {
  matches: Position[];
}

function fmtMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function PositionStrip({ matches }: PositionStripProps) {
  if (!matches || matches.length === 0) return null;
  return (
    <div className="position-strip">
      <span className="position-strip-label mono">your position</span>
      {matches.map((p) => {
        const up = p.cashPnl >= 0;
        return (
          <div key={p.conditionId} className="position-strip-card">
            <span className="position-outcome mono">{p.outcome}</span>
            <span className="mono">
              {p.size.toFixed(0)} @ {p.avgPrice.toFixed(2)}
            </span>
            <span className="mono muted">val {fmtMoney(p.currentValue)}</span>
            <span className={`mono ${up ? 'yes' : 'no'}`}>
              {fmtMoney(p.cashPnl)} · {up ? '+' : ''}
              {p.percentPnl.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
