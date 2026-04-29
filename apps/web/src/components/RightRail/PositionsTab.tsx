// PositionsTab — wallet input + position cards. Wallet-driven, beta cut.

import { useState, type ChangeEvent } from 'react';
import type { Position } from '../../types';

export interface PositionsTabProps {
  wallet: string;
  positions: Position[];
  onWalletChange: (wallet: string) => void;
}

function fmtMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function PositionsTab({ wallet, positions, onWalletChange }: PositionsTabProps) {
  const [draft, setDraft] = useState(wallet);

  const commit = () => {
    if (draft !== wallet) onWalletChange(draft);
  };

  return (
    <div className="positions-tab">
      <div className="wallet-input-row">
        <input
          className="wallet-input mono"
          placeholder="0x… polymarket wallet"
          value={draft}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
      </div>
      {positions.length === 0 && (
        <div className="positions-empty mono">no open positions for this wallet.</div>
      )}
      {positions.map((p) => {
        const up = p.cashPnl >= 0;
        return (
          <div key={p.conditionId} className="position-card">
            <div className="position-title">{p.title}</div>
            <div className="position-row">
              <span className="position-outcome mono">{p.outcome}</span>
              <span className="mono">
                {p.size.toFixed(0)} @ {p.avgPrice.toFixed(2)}
              </span>
            </div>
            <div className="position-row">
              <span className="position-meta mono">value</span>
              <span className="mono">{fmtMoney(p.currentValue)}</span>
            </div>
            <div className="position-row">
              <span className="position-meta mono">pnl</span>
              <span className={`mono ${up ? 'yes' : 'no'}`}>
                {fmtMoney(p.cashPnl)} · {up ? '+' : ''}
                {p.percentPnl.toFixed(1)}%
              </span>
            </div>
            {p.endDate && <div className="position-meta mono">resolves {p.endDate}</div>}
          </div>
        );
      })}
    </div>
  );
}
