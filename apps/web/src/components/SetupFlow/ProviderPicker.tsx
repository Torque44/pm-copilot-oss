// ProviderPicker — beta supports anthropic + claude-code-auto. Other providers behind expandable.

import { useState } from 'react';
import { KeyTester } from './KeyTester';
import type { ProviderName } from '../../types';

export interface ProviderPickerProps {
  selected: ProviderName | null;
  onSelect: (p: ProviderName) => void;
  onConfigured?: (info: { provider: ProviderName; key: string }) => void;
  onUseClaudeCode?: () => void;
}

const ADVANCED: { id: ProviderName; label: string; hint: string }[] = [
  { id: 'openai', label: 'openai', hint: 'gpt-4 / o-series · paste key' },
  { id: 'google', label: 'google', hint: 'gemini · paste key' },
  { id: 'perplexity', label: 'perplexity', hint: 'sonar grounding · paste key' },
  { id: 'xai', label: 'xai', hint: 'grok · enables sentiment tab' },
];

export function ProviderPicker({
  selected,
  onSelect,
  onConfigured,
  onUseClaudeCode,
}: ProviderPickerProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="provider-picker">
      <div className="provider-cards">
        <button
          className={`provider-card ${selected === 'anthropic' ? 'active' : ''}`}
          onClick={() => onSelect('anthropic')}
        >
          <div className="provider-card-title">anthropic api key</div>
          <div className="provider-card-sub mono">
            paste a key — claude opus / sonnet for grounding + brief
          </div>
        </button>
        <button
          className={`provider-card ${selected === 'anthropic-cc' ? 'active' : ''}`}
          onClick={() => {
            onSelect('anthropic-cc');
            onUseClaudeCode?.();
          }}
        >
          <div className="provider-card-title">claude code (auto-detect)</div>
          <div className="provider-card-sub mono">
            uses your local claude code session — no key paste needed
          </div>
        </button>
      </div>

      {selected === 'anthropic' && (
        <KeyTester
          provider="anthropic"
          onSuccess={(info) => onConfigured?.({ provider: info.provider, key: info.key })}
        />
      )}

      <button
        className="provider-advanced-toggle mono"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? '▾' : '▸'} other providers · available · paste in advanced
      </button>

      {showAdvanced && (
        <div className="provider-advanced">
          {ADVANCED.map((p) => (
            <div key={p.id} className="provider-advanced-row">
              <button
                className={`provider-pill ${selected === p.id ? 'active' : ''}`}
                onClick={() => onSelect(p.id)}
              >
                {p.label}
              </button>
              <span className="mono muted">{p.hint}</span>
              {selected === p.id && (
                <KeyTester
                  provider={p.id}
                  onSuccess={(info) =>
                    onConfigured?.({ provider: info.provider, key: info.key })
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
