// derivedStats.ts — pure functions that compute the VerdictBand stat strings
// from the brief's grounding rows. Kept stateless so they can be invoked from
// useMemo without thrashing.

import type { BookRow, HolderRow, Market } from '../types';
import { fmtMoney, fmtPrice } from './format';

/** Implied yield = (1 / yes_price - 1) for the YES side, expressed as %.
 *  For tail markets (yes < 0.05) the raw % is uninformative (10000%+); we
 *  switch to a multiple ("x73") so traders can read the payout shape. */
export function impliedYield(yes: number | undefined): string {
  if (yes == null || yes <= 0) return '—';
  const mult = 1 / yes;
  if (mult >= 20) return `×${mult.toFixed(0)}`;
  return `${((mult - 1) * 100).toFixed(1)}%`;
}

/** Spread = best YES ask - best YES bid, both in YES space. Uses 3 decimals
 *  so cheap markets (BTC tail with 0.001 spreads) don't render as "0.00". */
export function spreadFromBookRows(rows: BookRow[]): string {
  if (rows.length === 0) return '—';
  const noRows = rows.filter((r) => r.side === 'NO');
  const yesRows = rows.filter((r) => r.side === 'YES');
  if (noRows.length === 0 || yesRows.length === 0) return '—';
  const bestYesAsk = yesRows[0]!.price;
  const bestYesBid = 1 - noRows[0]!.price;
  const s = bestYesAsk - bestYesBid;
  if (!Number.isFinite(s)) return '—';
  return Math.max(0, s).toFixed(3);
}

/** Sum of YES-side size at the best level, in dollars. */
export function bookDepthYes(rows: BookRow[], yesPrice: number | undefined): string {
  const yesRows = rows.filter((r) => r.side === 'YES');
  if (yesRows.length === 0) return '—';
  const totalSize = yesRows.reduce((s, r) => s + (r.size || 0), 0);
  // Polymarket size in BookRow is dollar-volume already (cumulative emitted
  // is USD, not shares, after the supervisor's normaliseBook step).
  const at = yesPrice != null ? ` @ ${fmtPrice(yesPrice)}` : '';
  return `${fmtMoney(totalSize)}${at}`;
}

/** Top-N concentration: sum of top N USD sizes / total USD * 100. */
export function concentrationTopN(rows: HolderRow[], n: number): string {
  if (rows.length === 0) return '—';
  const total = rows.reduce((s, r) => s + (r.size || 0), 0);
  if (total <= 0) return '—';
  const top = rows.slice(0, n).reduce((s, r) => s + (r.size || 0), 0);
  return `${Math.round((top / total) * 100)}% top${n}`;
}

/** Build the 5-stat array consumed by VerdictBand. */
export function deriveVerdictStats(args: {
  market: Market | null;
  bookRows: BookRow[];
  holderRows: HolderRow[];
}): { label: string; value: string }[] {
  const { market, bookRows, holderRows } = args;
  return [
    { label: 'implied yield', value: impliedYield(market?.yes) },
    { label: 'days to resolve', value: market?.resolveIn || '—' },
    { label: 'book depth (yes)', value: bookDepthYes(bookRows, market?.yes) },
    { label: 'spread', value: spreadFromBookRows(bookRows) },
    { label: 'holders concentration', value: concentrationTopN(holderRows, 10) },
  ];
}
