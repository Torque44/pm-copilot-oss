// HoldersPanel — top-N wallet table inside the evidence grid.

import type { HolderRow } from '../../types';

const DEFAULT_ROWS: HolderRow[] = [
  { id: 'c-014', rank: 1, address: '0xABCD…1234', side: 'YES', size: 184200, pctYes: 12.4 },
  { id: 'c-015', rank: 2, address: '0x9F12…77AE', side: 'YES', size: 132800, pctYes: 8.9 },
  { id: 'c-016', rank: 3, address: '0x44E2…0BC1', side: 'NO', size: 98400, pctYes: null },
  { id: 'c-017', rank: 4, address: '0x31AA…FF02', side: 'YES', size: 71300, pctYes: 4.8 },
  { id: 'c-018', rank: 5, address: '0x7E33…8821', side: 'YES', size: 64100, pctYes: 4.3 },
  { id: 'c-019', rank: 6, address: '0xC901…A12F', side: 'NO', size: 52800, pctYes: null },
];

export interface HoldersPanelProps {
  flashId: string | null;
  rows?: HolderRow[];
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US').padStart(7, ' ')}`;
}

function shortAddr(addr: string): string {
  if (!addr) return '—';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function HoldersPanel({ flashId, rows }: HoldersPanelProps) {
  const data = rows && rows.length > 0 ? rows : DEFAULT_ROWS;
  return (
    <table className="dense">
      <thead>
        <tr>
          <th>#</th>
          <th>address</th>
          <th>side</th>
          <th className="num">size</th>
          <th className="num">% yes</th>
        </tr>
      </thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.id} id={`src-${r.id}`} className={flashId === r.id ? 'flash' : ''}>
            <td className="mono">{String(r.rank).padStart(2, '0')}</td>
            <td className="mono muted" title={r.address}>{shortAddr(r.address)}</td>
            <td className={r.side === 'YES' ? 'yes' : 'no'}>{r.side}</td>
            <td className="num mono">{fmtMoney(r.size)}</td>
            <td className="num mono">{r.pctYes === null ? '—' : `${r.pctYes.toFixed(1)}%`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
