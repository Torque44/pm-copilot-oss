// ProviderPicker — every provider visible as its own tile with live status.
//
// Replaces the previous "two big cards + advanced drawer" layout. The user
// asked for direct access to all providers and to hide tiles for providers
// already configured — instead of hiding them entirely, we show a compact
// "✓ connected" state with a remove button, so re-keying is one click.
//
// Slots a tile can target:
//   primary     — drives reasoning + brief synthesis + ask
//   perplexity  — news enrichment (used by newsAgent when present)
//   xai         — sentiment tab (also acceptable as primary; surfaced as
//                 two separate tiles so the user picks intent at paste time)

import { useState } from 'react';
import { KeyTester } from './KeyTester';
import { ClaudeCodeStatus } from './ClaudeCodeStatus';
import type { ProviderName } from '../../types';

type Slot = 'primary' | 'perplexity' | 'xai';

export interface ProviderPickerProps {
  /** Which slots are already configured. Tiles for these render in
   *  "connected" mode with a remove button. */
  configured: {
    primary: ProviderName | null;
    perplexity: boolean;
    xai: boolean;
  };
  /** Live claude-code subprocess reachability — drives the green dot on
   *  the claude-code tile without forcing a manual probe. */
  claudeCodeReachable?: boolean;
  onConfigured?: (info: { provider: ProviderName; key: string; slot?: Slot }) => void;
  onUseClaudeCode?: () => void;
  onRemove?: (slot: Slot) => void;
}

type TileDef = {
  /** Stable id for keying + which-tile-is-expanded tracking. */
  id: string;
  provider: ProviderName | null;
  slot: Slot;
  /** Header label shown on the tile. */
  label: string;
  /** Subhead (one-liner explaining the slot). */
  hint: string;
  /** Variant — drives the input UI. 'subprocess' renders ClaudeCodeStatus,
   *  'paste' renders KeyTester, 'multi' is for tiles that need a second
   *  click before showing the paste form (none currently). */
  variant: 'subprocess' | 'paste';
};

const TILES: TileDef[] = [
  {
    id: 'claude-code',
    provider: 'anthropic-cc',
    slot: 'primary',
    label: 'claude code',
    hint: 'use your local claude code session — no key paste needed',
    variant: 'subprocess',
  },
  {
    id: 'anthropic',
    provider: 'anthropic',
    slot: 'primary',
    label: 'anthropic api key',
    hint: 'paste a key — claude opus / sonnet for grounding + brief',
    variant: 'paste',
  },
  {
    id: 'openai',
    provider: 'openai',
    slot: 'primary',
    label: 'openai',
    hint: 'gpt-5 / o-series · use as primary',
    variant: 'paste',
  },
  {
    id: 'google',
    provider: 'google',
    slot: 'primary',
    label: 'google gemini',
    hint: 'gemini-2.5-pro · use as primary',
    variant: 'paste',
  },
  {
    id: 'xai-primary',
    provider: 'xai',
    slot: 'primary',
    label: 'xai (primary)',
    hint: 'grok-3 · primary reasoning + sentiment',
    variant: 'paste',
  },
  {
    id: 'perplexity',
    provider: 'perplexity',
    slot: 'perplexity',
    label: 'perplexity',
    hint: 'sonar · improves news (secondary)',
    variant: 'paste',
  },
  {
    id: 'xai-sentiment',
    provider: 'xai',
    slot: 'xai',
    label: 'xai (sentiment only)',
    hint: 'grok · sentiment tab only — primary stays as-is',
    variant: 'paste',
  },
];

function isTileConfigured(tile: TileDef, configured: ProviderPickerProps['configured']): boolean {
  if (tile.slot === 'primary' && tile.provider !== 'anthropic-cc') {
    return configured.primary === tile.provider;
  }
  if (tile.id === 'claude-code') {
    return configured.primary === 'anthropic-cc';
  }
  if (tile.slot === 'perplexity') return configured.perplexity;
  if (tile.slot === 'xai') return configured.xai;
  return false;
}

export function ProviderPicker({
  configured,
  claudeCodeReachable,
  onConfigured,
  onUseClaudeCode,
  onRemove,
}: ProviderPickerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="provider-picker">
      <div className="provider-tile-grid">
        {TILES.map((tile) => {
          const isConfigured = isTileConfigured(tile, configured);
          const isExpanded = expandedId === tile.id;

          return (
            <div
              key={tile.id}
              className={`provider-tile ${isConfigured ? 'connected' : ''} ${isExpanded ? 'expanded' : ''}`}
            >
              <button
                type="button"
                className="provider-tile-head"
                onClick={() => {
                  if (isConfigured) return; // connected tiles handle their own action
                  setExpandedId(isExpanded ? null : tile.id);
                }}
              >
                <div className="provider-tile-row">
                  <span className="provider-tile-label">{tile.label}</span>
                  {isConfigured && (
                    <span
                      className={`provider-tile-badge mono ${
                        tile.id === 'claude-code'
                          ? claudeCodeReachable === false
                            ? 'err'
                            : 'ok'
                          : 'ok'
                      }`}
                    >
                      {tile.id === 'claude-code' && claudeCodeReachable === false
                        ? '⚠ unreachable'
                        : '✓ connected'}
                    </span>
                  )}
                </div>
                <div className="provider-tile-hint mono">{tile.hint}</div>
              </button>

              {isConfigured && tile.id !== 'claude-code' && onRemove && (
                <button
                  type="button"
                  className="provider-tile-remove mono"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(tile.slot);
                  }}
                  title="remove this key"
                >
                  remove
                </button>
              )}

              {isExpanded && !isConfigured && tile.variant === 'subprocess' && onUseClaudeCode && (
                <div className="provider-tile-body">
                  <ClaudeCodeStatus
                    onConnected={onUseClaudeCode}
                    onSwitchToApiKey={() => setExpandedId('anthropic')}
                  />
                </div>
              )}

              {isExpanded && !isConfigured && tile.variant === 'paste' && tile.provider && (
                <div className="provider-tile-body">
                  <KeyTester
                    provider={tile.provider}
                    onSuccess={(info) =>
                      onConfigured?.({
                        provider: info.provider,
                        key: info.key,
                        slot: tile.slot,
                      })
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
