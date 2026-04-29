// BookPanel — order-book table inside the evidence grid.

import type { BookRow } from '../../types';

export interface BookPanelProps {
  flashId: string | null;
  rows?: BookRow[];
  /** Pre-computed spread; if omitted, derived from rows. */
  spread?: number;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US').padStart(7, ' ')}`;
}

function deriveSpread(noRows: BookRow[], yesRows: BookRow[]): number | null {
  if (noRows.length === 0 || yesRows.length === 0) return null;
  const bestYesAsk = yesRows[0]!.price;
  const bestYesBid = 1 - noRows[0]!.price;
  const s = bestYesAsk - bestYesBid;
  return Number.isFinite(s) ? Math.max(0, s) : null;
}

export function BookPanel({ flashId, rows, spread }: BookPanelProps) {
  const data = rows ?? [];
  if (data.length === 0) {
    return <div className="panel-placeholder mono">no orderbook data</div>;
  }
  const noRows = data.filter((r) => r.side === 'NO');
  const yesRows = data.filter((r) => r.side === 'YES');
  const sp = spread ?? deriveSpread(noRows, yesRows);

  return (
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
        {noRows.map((r) => (
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
        {yesRows.map((r) => (
          <tr key={r.id} id={`src-${r.id}`} className={flashId === r.id ? 'flash' : ''}>
            <td className="yes">YES</td>
            <td className="num mono">{r.price.toFixed(2)}</td>
            <td className="num mono">{fmtMoney(r.size)}</td>
            <td className="num mono">{fmtMoney(r.cum)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
