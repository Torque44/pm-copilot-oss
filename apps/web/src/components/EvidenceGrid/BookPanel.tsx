// BookPanel — order-book table inside the evidence grid.

import type { BookRow } from '../../types';

const DEFAULT_ROWS: BookRow[] = [
  { id: 'c-001', side: 'NO', price: 0.41, size: 12400, cum: 12400 },
  { id: 'c-002', side: 'NO', price: 0.4, size: 38100, cum: 50500 },
  { id: 'c-003', side: 'YES', price: 0.62, size: 84700, cum: 84700 },
  { id: 'c-004', side: 'YES', price: 0.61, size: 22300, cum: 107000 },
  { id: 'c-005', side: 'YES', price: 0.58, size: 4900, cum: 111900 },
];

export interface BookPanelProps {
  flashId: string | null;
  rows?: BookRow[];
  spread?: number;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US').padStart(7, ' ')}`;
}

export function BookPanel({ flashId, rows, spread = 0.03 }: BookPanelProps) {
  const data = rows && rows.length > 0 ? rows : DEFAULT_ROWS;
  // Split NO (asks) and YES (bids) so the spread divider falls in between.
  const noRows = data.filter((r) => r.side === 'NO');
  const yesRows = data.filter((r) => r.side === 'YES');

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
            — spread {spread.toFixed(2)} —
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
