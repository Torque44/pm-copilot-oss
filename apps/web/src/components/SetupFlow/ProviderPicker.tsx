// ProviderPicker — every provider visible as its own tile with live status.
//
// Multiple keys can be configured at once; each provider has its own storage
// slot in cryptoStorage. The orchestrator (the one that drives synthesis +
// ask routing) is computed: explicit override beats auto-rank
// (claude > gemini > openai > xai). Each connected tile shows a "PRIMARY"
// badge when it's the active orchestrator and a "use as primary" button
// when it's connected but isn't currently primary.
//
// Slot semantics:
//   primary candidates  — anthropic-cc / anthropic / google / openai / xai
//   sub-role: news      — perplexity (always secondary, never primary)
//   sub-role: sentiment — xai key is reused for sentiment automatically
//                         (no separate "xai sentiment-only" tile anymore)

import { useState } from 'react';
import { KeyTester } from './KeyTester';
import { ClaudeCodeStatus } from './ClaudeCodeStatus';
import type { ProviderName } from '../../types';

export interface ProviderPickerProps {
  /** Per-provider configured flags + the computed primary. */
  configured: {
    primary: ProviderName | null;
    primaryIsExplicit: boolean;
    hasAnthropic: boolean;
    hasAnthropicCC: boolean;
    hasGoogle: boolean;
    hasOpenAI: boolean;
    hasXai: boolean;
    hasPerplexity: boolean;
  };
  /** Live claude-code subprocess reachability — drives the green dot on
   *  the claude-code tile without forcing a manual probe. */
  claudeCodeReachable?: boolean;
  /** Server-side env keys reported by /api/health/providers. */
  envProviders?: Record<string, boolean> | undefined;
  onConfigured?: (info: { provider: ProviderName; key: string }) => void;
  onUseClaudeCode?: () => void;
  /** Click on a server-(free) tile = take the bundled key path. */
  onUseServer?: () => void;
  onRemove?: (provider: ProviderName) => void;
  /** Set this provider as the explicit primary (overrides auto-rank). */
  onSetPrimary?: (provider: ProviderName) => void;
}

type TileDef = {
  id: string;
  provider: ProviderName;
  /** Header label shown on the tile. */
  label: string;
  /** Subhead (one-liner). */
  hint: string;
  /** Drives the input UI. */
  variant: 'subprocess' | 'paste';
  /** Whether this tile is a primary candidate. perplexity is sub-role only. */
  primaryEligible: boolean;
};

const TILES: TileDef[] = [
  { id: 'claude-code', provider: 'anthropic-cc', label: 'claude code',
    hint: 'use your local claude code session — no key paste needed',
    variant: 'subprocess', primaryEligible: true },
  { id: 'anthropic', provider: 'anthropic', label: 'anthropic api key',
    hint: 'paste a key — claude opus / sonnet for grounding + brief',
    variant: 'paste', primaryEligible: true },
  { id: 'google', provider: 'google', label: 'google gemini',
    hint: 'gemini-2.5-pro — top-tier reasoning',
    variant: 'paste', primaryEligible: true },
  { id: 'openai', provider: 'openai', label: 'openai',
    hint: 'gpt-5 / o-series',
    variant: 'paste', primaryEligible: true },
  { id: 'xai', provider: 'xai', label: 'xai (grok)',
    hint: 'grok-3 with live X + web search — also powers sentiment',
    variant: 'paste', primaryEligible: true },
  { id: 'perplexity', provider: 'perplexity', label: 'perplexity',
    hint: 'sonar — boosts news (sub-role, never primary)',
    variant: 'paste', primaryEligible: false },
];

function isTileConfigured(
  tile: TileDef,
  c: ProviderPickerProps['configured'],
): boolean {
  switch (tile.provider) {
    case 'anthropic-cc': return c.hasAnthropicCC;
    case 'anthropic':    return c.hasAnthropic;
    case 'google':       return c.hasGoogle;
    case 'openai':       return c.hasOpenAI;
    case 'xai':          return c.hasXai;
    case 'perplexity':   return c.hasPerplexity;
    default: return false;
  }
}

export function ProviderPicker({
  configured,
  claudeCodeReachable,
  envProviders,
  onConfigured,
  onUseClaudeCode,
  onUseServer,
  onRemove,
  onSetPrimary,
}: ProviderPickerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The hosted deploy may have env-baked keys for one or more providers.
  // Render a "server (free)" badge on those tiles.
  const isServerConfigured = (tile: TileDef): boolean => {
    if (!envProviders || !tile.primaryEligible) return false;
    return envProviders[tile.provider] === true;
  };

  return (
    <div className="provider-picker">
      <div className="provider-tile-grid">
        {TILES.map((tile) => {
          const isConfigured = isTileConfigured(tile, configured);
          const isServer = !isConfigured && isServerConfigured(tile);
          const isExpanded = expandedId === tile.id;
          // Primary status is independent of how the key is sourced — a
          // server-(free) tile can be the orchestrator (override is honored
          // and the server uses its env var). So check `configured.primary`
          // directly, not just client-side configuration.
          const isPrimary = configured.primary === tile.provider;
          // "use as primary" surfaces on any primary-eligible tile that
          // has a usable credential — either client-stored OR a server env
          // key. perplexity is excluded (sub-role only).
          const canSetPrimary =
            tile.primaryEligible && !isPrimary && (isConfigured || isServer)
            && Boolean(onSetPrimary);

          return (
            <div
              key={tile.id}
              className={`provider-tile ${isConfigured ? 'connected' : ''} ${isServer ? 'server' : ''} ${isExpanded ? 'expanded' : ''} ${isPrimary ? 'is-primary' : ''}`}
            >
              <button
                type="button"
                className="provider-tile-head"
                onClick={() => {
                  if (isConfigured) return;
                  if (isServer && onUseServer) { onUseServer(); return; }
                  setExpandedId(isExpanded ? null : tile.id);
                }}
              >
                <div className="provider-tile-row">
                  <span className="provider-tile-label">{tile.label}</span>
                  {isPrimary && (
                    <span className="provider-tile-badge mono ok" title="orchestrator: drives synthesis + ask routing">
                      ★ primary
                    </span>
                  )}
                  {isConfigured && !isPrimary && (
                    <span className={`provider-tile-badge mono ${
                      tile.id === 'claude-code' && claudeCodeReachable === false ? 'err' : 'ok'
                    }`}>
                      {tile.id === 'claude-code' && claudeCodeReachable === false
                        ? '⚠ unreachable' : '✓ connected'}
                    </span>
                  )}
                  {isServer && (
                    <span className="provider-tile-badge mono ok">✓ server (free)</span>
                  )}
                </div>
                <div className="provider-tile-hint mono">
                  {isServer ? 'this hosted deploy ships with a key — click to use it free' : tile.hint}
                </div>
              </button>

              {isServer && !isExpanded && (
                <button
                  type="button"
                  className="provider-tile-byok mono"
                  onClick={(e) => { e.stopPropagation(); setExpandedId(tile.id); }}
                >
                  paste your own key instead →
                </button>
              )}

              {canSetPrimary && (
                <button
                  type="button"
                  className="provider-tile-set-primary mono"
                  onClick={(e) => { e.stopPropagation(); onSetPrimary?.(tile.provider); }}
                  title="make this the orchestrator (overrides auto-rank)"
                >
                  use as primary
                </button>
              )}

              {isConfigured && tile.id !== 'claude-code' && onRemove && (
                <button
                  type="button"
                  className="provider-tile-remove mono"
                  onClick={(e) => { e.stopPropagation(); onRemove(tile.provider); }}
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

              {isExpanded && !isConfigured && tile.variant === 'paste' && (
                <div className="provider-tile-body">
                  <KeyTester
                    provider={tile.provider}
                    onSuccess={(info) => onConfigured?.({ provider: info.provider, key: info.key })}
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
