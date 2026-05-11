// SetupScreen — full-screen overlay (or drop-in modal) for managing
// provider keys. Always shows every provider as a tile so users can add or
// switch keys directly without digging through an advanced drawer.

import { useEffect } from 'react';
import { ProviderPicker } from './ProviderPicker';
import type { ProviderConfig, ProviderName } from '../../types';

export interface SetupScreenProps {
  onConfigured: (info: { provider: ProviderName; key: string }) => void;
  onSkip?: () => void;
  /** Called when the user picks the claude-code tile. Distinct from onSkip:
   *  this should also persist anthropic-cc as the primary provider so the
   *  tile renders connected on next open. */
  onUseClaudeCode?: () => void;
  /** Called when the user clicks a "✓ server (free)" tile. */
  onUseServer?: () => void;
  /** Per-provider configured flags + computed primary. Drives tile state. */
  configured: ProviderConfig;
  /** Live claude code reachability — when false the claude-code tile shows
   *  ⚠ unreachable instead of ✓ connected. */
  claudeCodeReachable?: boolean;
  /** Server-side env keys reported by /api/health/providers. */
  envProviders?: Record<string, boolean> | undefined;
  /** Remove a configured provider's key. */
  onRemove?: (provider: ProviderName) => void;
  /** Set this provider as the explicit primary (overrides auto-rank). */
  onSetPrimary?: (provider: ProviderName) => void;
  /** Clear the primary override so auto-rank takes over. */
  onClearPrimary?: () => void;
  /** When true, Esc and backdrop click are no-ops if nothing is configured. */
  requireChoice?: boolean;
}

export function SetupScreen({
  onConfigured,
  onSkip,
  onUseClaudeCode,
  onUseServer,
  configured,
  claudeCodeReachable,
  envProviders,
  onRemove,
  onSetPrimary,
  onClearPrimary,
  requireChoice = false,
}: SetupScreenProps) {
  const anyConfigured =
    !!configured.primary || configured.hasPerplexity;
  // First-time gate (requireChoice + nothing configured): Esc and backdrop
  // are inert. Otherwise they soft-close the overlay. This prevents an
  // accidental Esc from permanently parking a new user in a half-broken
  // workbench just because their finger twitched.
  const dismissable = !requireChoice || anyConfigured;
  const handleDismiss = dismissable ? onSkip : undefined;

  // Esc → close (treat as "use local Claude Code" path when nothing's set).
  useEffect(() => {
    if (!dismissable) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSkip, dismissable]);

  return (
    <div className="setup-screen" onClick={handleDismiss}>
      <div className="setup-card setup-card-wide" onClick={(e) => e.stopPropagation()}>
        <header className="setup-head">
          <div className="setup-head-row">
            <h1 className="setup-title">pm copilot · setup</h1>
            {handleDismiss && (
              <button
                type="button"
                className="setup-close"
                onClick={handleDismiss}
                aria-label="close"
                title="close (esc)"
              >
                ×
              </button>
            )}
          </div>
          <p className="setup-sub mono">
            {anyConfigured
              ? 'add another provider, swap keys, or remove what you don’t use. keys are encrypted in this browser only.'
              : 'pick a provider to ground your briefs. keys live encrypted in this browser only.'}
          </p>
        </header>
        <ProviderPicker
          configured={configured}
          {...(claudeCodeReachable !== undefined ? { claudeCodeReachable } : {})}
          {...(envProviders ? { envProviders } : {})}
          onConfigured={onConfigured}
          onUseClaudeCode={onUseClaudeCode ?? onSkip}
          onUseServer={onUseServer ?? onSkip}
          {...(onRemove ? { onRemove } : {})}
          {...(onSetPrimary ? { onSetPrimary } : {})}
          {...(onClearPrimary ? { onClearPrimary } : {})}
        />
        <footer className="setup-foot mono">
          esc to close · keys never leave this browser
        </footer>
      </div>
    </div>
  );
}
