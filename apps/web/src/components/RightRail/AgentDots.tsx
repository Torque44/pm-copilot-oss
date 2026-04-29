// AgentDots — 7-dot agent status row with hover tooltips that explain what
// each agent does. Order matches the supervisor's emit topology:
//   market · holders · news · thesis · sentiment · synthesis · ask

import type { AgentStatus, BriefAgentDetail } from '../../types';

type AgentMeta = {
  key: string;
  label: string;
  /** What this agent fetches/derives. Shown in the hover card. */
  does: string;
  /** Source it grounds in. */
  source: string;
};

export const AGENTS: readonly AgentMeta[] = [
  {
    key: 'market',
    label: 'market',
    does: 'reads the orderbook, computes mid + spread + depth + slippage curves',
    source: 'polymarket clob',
  },
  {
    key: 'holders',
    label: 'holders',
    does: 'pulls top-N wallets, side bias, concentration ratio',
    source: 'polymarket data api',
  },
  {
    key: 'news',
    label: 'news',
    does: 'web-searches for dated catalysts in the last 48h + scheduled events in the next 72h',
    source: 'web search via primary provider',
  },
  {
    key: 'thesis',
    label: 'thesis',
    does: 'builds a causal claim tree: top claim, 3-5 testable sub-claims with probabilities, kill-thesis pass',
    source: 'reasoning-tier llm + upstream citations',
  },
  {
    key: 'sentiment',
    label: 'sentiment',
    does: 'reads recent X posts from prediction-market kols and outputs their lean with quoted citations',
    source: 'xai grok + curated kol tweets',
  },
  {
    key: 'synthesis',
    label: 'synthesis',
    does: 'merges all specialist sections into the final brief with citation-id allowlist (anti-hallucination)',
    source: 'reasoning-tier llm',
  },
  {
    key: 'ask',
    label: 'ask',
    does: 'answers a chat question grounded in the cached book/holders/news for this market',
    source: 'on-demand · primary provider',
  },
] as const;

const STATUS_COPY: Record<AgentStatus, string> = {
  pending: 'queued',
  running: 'running…',
  done: 'completed',
  error: 'failed',
};

export interface AgentDotsProps {
  states: AgentStatus[];
  /** Optional per-slot details (error text + elapsedMs). Index aligned with
   *  AGENTS order. Surfaced inside the hover tooltip. */
  details?: Array<BriefAgentDetail | undefined>;
}

function fmtElapsed(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AgentDots({ states, details }: AgentDotsProps) {
  return (
    <div className="agent-dots">
      <span className="agent-label mono">agents</span>
      {AGENTS.map((a, i) => {
        const status: AgentStatus = states[i] ?? 'pending';
        const detail = details?.[i];
        const elapsed = fmtElapsed(detail?.elapsedMs);
        return (
          <span key={a.key} className="agent-dot-wrap">
            <span className={`dot ${status}`} />
            <span className="agent-dot-tooltip" role="tooltip">
              <span className="agent-dot-tooltip-head">
                <span className="agent-dot-tooltip-name">{a.label}</span>
                <span className={`agent-dot-tooltip-status ${status}`}>
                  {STATUS_COPY[status]}{elapsed ? ` · ${elapsed}` : ''}
                </span>
              </span>
              <span className="agent-dot-tooltip-body">{a.does}</span>
              {status === 'error' && detail?.error && (
                <span className="agent-dot-tooltip-error mono">{detail.error.slice(0, 200)}</span>
              )}
              <span className="agent-dot-tooltip-meta mono">{a.source}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
