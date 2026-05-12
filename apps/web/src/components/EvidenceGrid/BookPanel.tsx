// BookPanel — order-book table inside the evidence grid.
//
// Default view shows the TOP 5 of each side stacked around the spread row,
// so a user opening the market sees both YES and NO best-of-book without
// scrolling. Click "show all N" to expand the full ladder.

import { useState } from 'react';
import type { BookRow } from '../../types';

export interface BookPanelProps {
  flashId: string | null;
  rows?: BookRow[];
  /** Pre-computed spread; if omitted, derived from rows. */
  spread?: number;
}

const COLLAPSED_PER_SIDE = 5;

function fmtMoney(n: number): string {
  // No padStart — leading whitespace collapses in HTML. Column alignment
  // is handled by `text-align: right` + tabular numbers in CSS.
  return `$${n.toLocaleString('en-US')}`;
}

function deriveSpread(noRows: BookRow[], yesRows: BookRow[]): number | null {
  if (noRows.length === 0 || yesRows.length === 0) return null;
  const bestYesAsk = yesRows[0]!.price;
  const bestYesBid = 1 - noRows[0]!.price;
  const s = bestYesAsk - bestYesBid;
  return Number.isFinite(s) ? Math.max(0, s) : null;
}

export function BookPanel({ flashId, rows, spread }: BookPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const data = rows ?? [];
  if (data.length === 0) {
    return <div className="panel-placeholder mono">no orderbook data</div>;
  }
  const noRows = data.filter((r) => r.side === 'NO');
  const yesRows = data.filter((r) => r.side === 'YES');
  const sp = spread ?? deriveSpread(noRows, yesRows);

  // Upstream sorts bids/asks best-first, so the FIRST N of each side are
  // the rows closest to the spread.
  const noVisible = expanded ? noRows : noRows.slice(0, COLLAPSED_PER_SIDE);
  const yesVisible = expanded ? yesRows : yesRows.slice(0, COLLAPSED_PER_SIDE);
  const hiddenCount = (noRows.length - noVisible.length) + (yesRows.length - yesVisible.length);

  return (
    <div className="book-panel-wrap">
      <table className="dense">
        <thead>
          <tr>
            <th>side</th>
            <th className="num">price</th>
            <th className="num">size</th>
            <th className="num">cum</th>
          </tr>
        </thead>
        <tbody>
          {noVisible.map((r) => (
            <tr key={r.id} id={`src-${r.id}`} className={flashId === r.id ? 'flash' : ''}>
              <td className="no">NO</td>
              <td className="num mono">{r.price.toFixed(2)}</td>
              <td className="num mono">{fmtMoney(r.size)}</td>
              <td className="num mono">{fmtMoney(r.cum)}</td>
            </tr>
          ))}
          <tr className="spread-row">
            <td colSpan={4} className="mono">
              — spread {sp != null ? sp.toFixed(3) : '—'} —
            </td>
          </tr>
          {yesVisible.map((r) => (
            <tr key={r.id} id={`src-${r.id}`} className={flashId === r.id ? 'flash' : ''}>
              <td className="yes">YES</td>
              <td className="num mono">{r.price.toFixed(2)}</td>
              <td className="num mono">{fmtMoney(r.size)}</td>
              <td className="num mono">{fmtMoney(r.cum)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="book-toggle mono"
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
        >
          show all {data.length} levels ({hiddenCount} hidden) ↓
        </button>
      )}
      {expanded && (
        <button
          type="button"
          className="book-toggle mono"
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
        >
          show top 5 each side ↑
        </button>
      )}
    </div>
  );
}
