// KeyTester — paste an api key, fire `/api/auth/test`, show pass/fail inline.

import { useState, type ChangeEvent } from 'react';
import type { ProviderName } from '../../types';

export interface KeyTesterProps {
  provider: ProviderName;
  onSuccess?: (info: { provider: ProviderName; key: string; model?: string; ms?: number }) => void;
}

interface TestResult {
  ok: boolean;
  message: string;
}

interface AuthTestResponse {
  ok: boolean;
  model?: string;
  ms?: number;
  status?: number;
  error?: string;
}

export function KeyTester({ provider, onSuccess }: KeyTesterProps) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const test = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch('/api/auth/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, key }),
      });
      const json = (await r.json()) as AuthTestResponse;
      if (json.ok) {
        setResult({
          ok: true,
          message: `key works · model ${json.model ?? '?'} · ${json.ms ?? '?'}ms`,
        });
        onSuccess?.({ provider, key, model: json.model, ms: json.ms });
      } else {
        const status = json.status ?? r.status;
        setResult({
          ok: false,
          message: `HTTP ${status} · ${json.error ?? 'check key prefix'}`,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'network error';
      setResult({ ok: false, message: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="key-tester">
      <div className="key-tester-row">
        <input
          className="key-input mono"
          type="password"
          placeholder={`${provider} api key`}
          value={key}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setKey(e.target.value)}
          onBlur={test}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="key-test-btn" onClick={test} disabled={busy || !key.trim()}>
          {busy ? 'testing…' : 'test'}
        </button>
      </div>
      {result && (
        <div className={`key-test-result mono ${result.ok ? 'ok' : 'err'}`}>
          {result.ok ? '✓' : '✗'} {result.message}
        </div>
      )}
    </div>
  );
}
