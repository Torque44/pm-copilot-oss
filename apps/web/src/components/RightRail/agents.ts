// AGENTS — agent metadata used by the right rail's AgentList component.
//
// Order matches the supervisor's emit topology:
//   market · holders · news · thesis · sentiment · synthesis · ask
//
// The horizontal-dot row + portal overlay this file used to export was
// retired when the right rail switched to the vertical AgentList. The
// constant is kept here (rather than colocated with AgentList) for the
// same reason a registry lives separately: it's data, not a component.

type AgentMeta = {
  key: string;
  label: string;
  /** What this agent fetches/derives. Shown in tooltips. */
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
    does: 'reads recent X posts from prediction-market accounts and outputs their lean with quoted citations',
    source: 'xai grok + curated handles',
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
