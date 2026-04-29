// AgentDots — 7-dot agent status row.

import type { AgentStatus } from '../../types';

// 7-slot agent topology actually emitted by the supervisor + chat handler:
//   market · holders · news · thesis · sentiment · synthesis · ask
// (sentiment runs only when xAI is configured; ask is a separate /api/ask
// handler triggered by chat. agentStatesFromBrief in App.tsx maps brief
// agent statuses to these slots in this order.)
export const AGENTS = [
  { key: 'market', label: 'market' },
  { key: 'holders', label: 'holders' },
  { key: 'news', label: 'news' },
  { key: 'thesis', label: 'thesis' },
  { key: 'sentiment', label: 'sentiment' },
  { key: 'synthesis', label: 'synthesis' },
  { key: 'ask', label: 'ask' },
] as const;

export interface AgentDotsProps {
  states: AgentStatus[];
}

export function AgentDots({ states }: AgentDotsProps) {
  return (
    <div className="agent-dots">
      <span className="agent-label mono">agents</span>
      {AGENTS.map((a, i) => {
        const status: AgentStatus = states[i] ?? 'pending';
        return (
          <span
            key={a.key}
            className={`dot ${status}`}
            title={`${a.label} · ${status}`}
          />
        );
      })}
    </div>
  );
}
