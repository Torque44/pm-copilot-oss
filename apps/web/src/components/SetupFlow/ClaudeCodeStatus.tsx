// ClaudeCodeStatus — inline connection check that lives inside the
// "claude code (auto-detect)" card on the setup modal.
//
// Probes /api/health/providers on mount and shows:
//   green:  "✓ connected · using subprocess"  → safe to dismiss the modal
//   red:    error banner + one-click copy of `claude /login` + recheck btn
//   loading: spinner while we probe
//
// Critical: when the user clicks the card, we BLOCK the skip-to-home
// transition until a probe succeeds. Without this they get the empty
// workbench + 5 dead agents and have no idea why.

import { useEffect, useState } from 'react';
import { apiJSON } from '../../lib/client';

const LOGIN_CMD = 'claude /login';

type Probe = { ok: boolean; ms: number; model?: string; error?: string };
type ProbeResp = { primary: string; checks: Record<string, Probe> };

export interface ClaudeCodeStatusProps {
  /** Called when probe is green and the user opts to use subprocess. */
  onConnected: () => void;
  /** Hint to the parent that user wants to switch to API-key path instead. */
  onSwitchToApiKey?: () => void;
}

export function ClaudeCodeStatus({ onConnected, onSwitchToApiKey }: ClaudeCodeStatusProps) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const j = await apiJSON<ProbeResp>('/api/health/providers');
      setProbe(j.checks['claude-code'] ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProbe({ ok: false, ms: 0, error: `probe failed: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void run();
  }, []);

  const copyCmd = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(LOGIN_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can manually copy from the visible code block */
    }
  };

  return (
    <div className="cc-status">
      {loading && !probe && (
        <div className="cc-status-row">
          <span className="cc-status-dot pending" />
          <span className="mono muted">checking claude code session…</span>
        </div>
      )}

      {probe?.ok && (
        <>
          <div className="cc-status-row">
            <span className="cc-status-dot ok" />
            <span className="cc-status-name mono">connected</span>
            <span className="cc-status-meta mono muted">
              {probe.model ?? 'subprocess'} · {probe.ms}ms
            </span>
          </div>
          <button
            type="button"
            className="cc-status-continue"
            onClick={onConnected}
          >
            use claude code →
          </button>
        </>
      )}

      {probe && !probe.ok && (
        <>
          <div className="cc-status-row">
            <span className="cc-status-dot err" />
            <span className="cc-status-name mono">not authenticated</span>
          </div>
          <div className="cc-status-error mono">
            {probe.error || 'claude code is not logged in'}
          </div>
          <div className="cc-status-fix">
            <div className="mono muted">open a fresh windows cmd and run:</div>
            <div className="cc-status-cmd-row">
              <code className="cc-status-cmd mono">{LOGIN_CMD}</code>
              <button
                type="button"
                className="cc-status-copy mono"
                onClick={copyCmd}
              >
                {copied ? 'copied!' : 'copy'}
              </button>
            </div>
            <div className="mono muted">
              right-click the cmd window to paste the auth code from your
              browser. then come back here and click recheck.
            </div>
          </div>
          <div className="cc-status-actions">
            <button
              type="button"
              className="cc-status-recheck"
              onClick={run}
              disabled={loading}
            >
              {loading ? 'checking…' : 'recheck'}
            </button>
            {onSwitchToApiKey && (
              <button
                type="button"
                className="cc-status-altpath mono"
                onClick={onSwitchToApiKey}
              >
                or paste an api key instead →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
