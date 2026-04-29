// SetupScreen — full-screen overlay shown when no provider is configured.
//
// Two paths:
//   1. Paste a provider API key (Anthropic/OpenAI/Gemini/Perplexity/xAI). Tested
//      via /api/auth/test before saving to IndexedDB AES-GCM.
//   2. "Use local Claude Code" — user already has the Claude Code CLI
//      authenticated; the server falls back to subprocess auth. This sets
//      a localStorage flag so the gate stops redirecting.

import { useEffect, useState } from 'react';
import { ProviderPicker } from './ProviderPicker';
import type { ProviderName } from '../../types';

export interface SetupScreenProps {
  onConfigured: (info: { provider: ProviderName; key: string }) => void;
  onSkip?: () => void;
}

export function SetupScreen({ onConfigured, onSkip }: SetupScreenProps) {
  const [selected, setSelected] = useState<ProviderName | null>(null);

  // Esc → skip (treat as "use local Claude Code" path).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSkip]);

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <header className="setup-head">
          <h1 className="setup-title">pm copilot · setup</h1>
          <p className="setup-sub mono">
            pick a provider to ground your briefs. keys live encrypted in this browser only.
          </p>
        </header>
        <ProviderPicker
          selected={selected}
          onSelect={setSelected}
          onConfigured={onConfigured}
          onUseClaudeCode={onSkip}
        />
        <footer className="setup-foot mono">
          esc to skip · pick "claude code" if your CLI is already authed · keys never leave this browser
        </footer>
      </div>
    </div>
  );
}
