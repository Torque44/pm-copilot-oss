// ProviderPicker — pick a primary LLM (anthropic / openai / google / xai) +
// optional secondary keys (perplexity for news, xai for sentiment).
//
// Each provider in the advanced list has a `slot` indicator so users know
// where the key lands: 'primary' replaces the main reasoning provider,
// 'perplexity' = news enhancement, 'xai-secondary' = sentiment-only.

import { useState } from 'react';
import { KeyTester } from './KeyTester';
import type { ProviderName } from '../../types';

export interface ProviderPickerProps {
  selected: ProviderName | null;
  onSelect: (p: ProviderName) => void;
  onConfigured?: (info: { provider: ProviderName; key: string; slot?: 'primary' | 'perplexity' | 'xai' }) => void;
  onUseClaudeCode?: () => void;
}

type AdvancedRow = {
  id: ProviderName;
  label: string;
  hint: string;
  /** Where this key lands when saved. */
  slot: 'primary' | 'perplexity' | 'xai';
};

const ADVANCED: AdvancedRow[] = [
  { id: 'openai', label: 'openai', hint: 'gpt-5 / o-series · use as primary', slot: 'primary' },
  { id: 'google', label: 'google', hint: 'gemini-2.5-pro · use as primary', slot: 'primary' },
  { id: 'xai', label: 'xai (primary)', hint: 'grok-3 · use as primary, also enables sentiment', slot: 'primary' },
  { id: 'perplexity', label: 'perplexity', hint: 'sonar · improves news (secondary slot)', slot: 'perplexity' },
  { id: 'xai', label: 'xai (sentiment only)', hint: 'grok · sentiment tab only, primary stays as-is', slot: 'xai' },
];

export function ProviderPicker({
  selected,
  onSelect,
  onConfigured,
  onUseClaudeCode,
}: ProviderPickerProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeAdvancedIdx, setActiveAdvancedIdx] = useState<number | null>(null);

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
          {ADVANCED.map((p, idx) => {
            const isActive = activeAdvancedIdx === idx;
            return (
              <div key={`${p.id}-${p.slot}`} className="provider-advanced-row">
                <button
                  className={`provider-pill ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setActiveAdvancedIdx(isActive ? null : idx);
                    onSelect(p.id);
                  }}
                >
                  {p.label}
                </button>
                <span className="mono muted">{p.hint}</span>
                {isActive && (
                  <KeyTester
                    provider={p.id}
                    onSuccess={(info) =>
                      // Forward the explicit slot so xai-as-primary lands
                      // in 'primary' while xai-secondary lands in 'xai'.
                      onConfigured?.({ provider: info.provider, key: info.key, slot: p.slot })
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
