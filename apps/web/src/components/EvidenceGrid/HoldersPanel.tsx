// HoldersPanel — top-N wallet table inside the evidence grid.

import type { HolderRow } from '../../types';

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
  const data = rows ?? [];
  if (data.length === 0) {
    return <div className="panel-placeholder mono">no holders data</div>;
  }
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
