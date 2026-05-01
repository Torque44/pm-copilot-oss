// AgentList — vertical agent-status list for the right rail.
//
// Replaces the horizontal dot row in the rail (the dot row + hover overlay
// pattern is still useful for compact headers, but the rail design from the
// reference uses a per-agent row with dot + name + status). One line per
// agent, status text right-aligned, hover the row to see the agent's
// description and any error detail.

import { AGENTS } from './agents';
import type { AgentStatus, BriefAgentDetail } from '../../types';

const STATUS_COPY: Record<AgentStatus, string> = {
  pending: 'queued',
  running: 'running…',
  done: 'DONE',
  error: 'FAILED',
};

function fmtElapsed(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export interface AgentListProps {
  states: AgentStatus[];
  details?: Array<BriefAgentDetail | undefined>;
}

export function AgentList({ states, details }: AgentListProps) {
  return (
    <ul className="agent-list">
      {AGENTS.map((a, i) => {
        const status: AgentStatus = states[i] ?? 'pending';
        const detail = details?.[i];
        const elapsed = fmtElapsed(detail?.elapsedMs);
        const tooltip = a.does + (detail?.error ? `\n\nerror: ${detail.error.slice(0, 240)}` : '');
        return (
          <li
            key={a.key}
            className={`agent-list-row status-${status}`}
            title={tooltip}
          >
            <span className={`dot ${status}`} />
            <span className="agent-list-name">{a.label}</span>
            <span className={`agent-list-status mono ${status}`}>
              {STATUS_COPY[status]}{elapsed ? ` · ${elapsed}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
