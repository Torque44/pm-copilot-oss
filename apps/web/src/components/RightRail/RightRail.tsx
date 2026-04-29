// RightRail — context rail (280px). agents + watchlist + positions.

import { AgentDots } from './AgentDots';
import { WatchlistTab } from './WatchlistTab';
import { PositionsTab } from './PositionsTab';
import type { AgentStatus, Position, WatchItem } from '../../types';

export interface RightRailProps {
  collapsed: boolean;
  agentStates: AgentStatus[];
  watchlist?: WatchItem[];
  onWatchlistRemove?: (marketId: string) => void;
  wallet?: string;
  positions?: Position[];
  onWalletChange?: (wallet: string) => void;
}

export function RightRail({
  collapsed,
  agentStates,
  watchlist = [],
  onWatchlistRemove,
  wallet = '',
  positions = [],
  onWalletChange,
}: RightRailProps) {
  if (collapsed) return null;

  return (
    <aside className="rail-right">
      <div className="rail-section">
        <div className="rail-section-title">agents</div>
        <AgentDots states={agentStates} />
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
