// RightRail — context rail (280px). agents + watchlist + positions.

import { AgentDots } from './AgentDots';
import { WatchlistTab } from './WatchlistTab';
import { PositionsTab } from './PositionsTab';
import { ProviderHealth } from './ProviderHealth';
import type { ProviderHealthResponse } from '../../hooks/useProviderHealth';
import type { AgentStatus, BriefAgentDetail, Position, WatchItem } from '../../types';

export interface RightRailProps {
  collapsed: boolean;
  agentStates: AgentStatus[];
  /** Per-slot detail (elapsed + error) aligned with agentStates index. */
  agentDetails?: Array<BriefAgentDetail | undefined>;
  watchlist?: WatchItem[];
  onWatchlistRemove?: (marketId: string) => void;
  wallet?: string;
  positions?: Position[];
  onWalletChange?: (wallet: string) => void;
  /** Discovery affordance for paste-key flow — opens /setup. */
  onOpenSetup?: () => void;
  /** Whether the user has additional provider keys configured (drives the
   *  small badge next to the providers button). */
  providerSummary?: { primary: string | null; perplexity: boolean; xai: boolean };
  /** Live connection-status probe data (drives the green/red dot row
   *  under "agents"). Optional — hides the section when omitted. */
  providerHealth?: {
    data: ProviderHealthResponse | null;
    loading: boolean;
    error: string | null;
    lastCheckedAt: number | null;
    onRecheck: () => void;
  };
}

export function RightRail({
  collapsed,
  agentStates,
  agentDetails,
  watchlist = [],
  onWatchlistRemove,
  wallet = '',
  positions = [],
  onWalletChange,
  onOpenSetup,
  providerSummary,
  providerHealth,
}: RightRailProps) {
  if (collapsed) return null;

  const providerLine = providerSummary
    ? [
        providerSummary.primary || 'subprocess',
        providerSummary.perplexity ? 'perplexity' : null,
        providerSummary.xai ? 'xai' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'subprocess';

  return (
    <aside className="rail-right">
      <div className="rail-section">
        <div className="rail-section-title rail-section-title-row">
          <span>agents</span>
          {onOpenSetup && (
            <button
              type="button"
              className="rail-providers-btn mono"
              onClick={onOpenSetup}
              title="add or change provider keys"
            >
              providers
            </button>
          )}
        </div>
        <AgentDots states={agentStates} {...(agentDetails ? { details: agentDetails } : {})} />
        <div className="agent-legend mono">
          <span>
            <span className="dot pending" /> pending
          </span>
          <span>
            <span className="dot running" /> running
          </span>
          <span>
            <span className="dot done" /> done
          </span>
          <span>
            <span className="dot error" /> error
          </span>
        </div>
        <div className="rail-providers-summary mono">{providerLine}</div>
        {providerHealth && (
          <ProviderHealth
            health={providerHealth.data}
            loading={providerHealth.loading}
            error={providerHealth.error}
            lastCheckedAt={providerHealth.lastCheckedAt}
            onRecheck={providerHealth.onRecheck}
          />
        )}
      </div>

      <div className="rail-section">
        <div className="rail-section-title">watchlist</div>
        <WatchlistTab items={watchlist} onRemove={onWatchlistRemove ?? (() => {})} />
      </div>

      <div className="rail-section">
        <div className="rail-section-title">positions</div>
        <PositionsTab
          wallet={wallet}
          positions={positions}
          onWalletChange={onWalletChange ?? (() => {})}
        />
      </div>
    </aside>
  );
}
