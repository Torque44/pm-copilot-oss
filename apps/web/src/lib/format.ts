// Display formatters used across the workbench.

/**
 * Format an ISO date string as relative duration to now ("60d 14h").
 * Returns '—' if the date is invalid or already past.
 */
export function formatRelativeDuration(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const ms = t - Date.now();
  if (ms < 0) return 'resolved';
  const totalMins = Math.floor(ms / 60_000);
  const totalHours = Math.floor(totalMins / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Round a number with thousands separators. Returns '—' for non-finite. */
export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** "0.62" — two decimals, never NaN. */
export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

/** Truncate to maxLen chars (no trailing ellipsis if shorter). */
export function truncate(s: string, maxLen: number): string {
  if (!s) return '';
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}
