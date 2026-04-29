// ProviderHealth — green/red status row showing whether the configured
// providers actually answer right now. Probes via /api/health/providers.
// Click "recheck" to re-probe after running `claude /login`.

import type { ProviderHealthResponse } from '../../hooks/useProviderHealth';

export interface ProviderHealthProps {
  health: ProviderHealthResponse | null;
  loading: boolean;
  error: string | null;
  lastCheckedAt: number | null;
  onRecheck: () => void;
}

function fmtAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

export function ProviderHealth({ health, loading, error, lastCheckedAt, onRecheck }: ProviderHealthProps) {
  if (error && !health) {
    return (
      <div className="provider-health">
        <div className="provider-health-row">
          <span className="provider-health-dot err" />
          <span className="mono muted">probe failed: {error.slice(0, 60)}</span>
          <button type="button" className="provider-health-recheck mono" onClick={onRecheck}>
            recheck
          </button>
        </div>
      </div>
    );
  }
  if (!health) {
    return (
      <div className="provider-health">
        <div className="provider-health-row">
          <span className="provider-health-dot pending" />
          <span className="mono muted">checking providers…</span>
        </div>
      </div>
    );
  }

  const checks = health.checks;
  const primary = health.primary;

  // Order: claude-code first (most users), then primary if different, then alphabetical.
  const keys = Object.keys(checks);
  keys.sort((a, b) => {
    if (a === 'claude-code') return -1;
    if (b === 'claude-code') return 1;
    if (a === primary) return -1;
    if (b === primary) return 1;
    return a.localeCompare(b);
  });

  const age = lastCheckedAt ? Date.now() - lastCheckedAt : null;

  return (
    <div className="provider-health">
      {keys.map((k) => {
        const c = checks[k]!;
        const cls = c.ok ? 'ok' : 'err';
        const label = k === 'claude-code' ? 'claude code' : k;
        return (
          <div key={k} className="provider-health-row" title={c.ok ? `${c.model ?? 'ok'} · ${c.ms}ms` : c.error}>
            <span className={`provider-health-dot ${cls}`} />
            <span className="provider-health-name mono">{label}</span>
            <span className="provider-health-status mono muted">
              {c.ok ? `connected · ${c.ms}ms` : 'not reachable'}
            </span>
          </div>
        );
      })}
      <div className="provider-health-foot mono muted">
        {age != null ? `checked ${fmtAge(age)}` : 'checked just now'}
        {' · '}
        <button type="button" className="provider-health-recheck mono" onClick={onRecheck} disabled={loading}>
          {loading ? 'checking…' : 'recheck'}
        </button>
      </div>
    </div>
  );
}
