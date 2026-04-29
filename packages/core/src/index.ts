// @pm-copilot/core — public surface
//
// Pure logic; zero DOM/server deps. Anyone can build their own UI on top.

export * from './agents/types';
export { runSupervisor, type SupervisorOpts, type RememberGrounding } from './agents/supervisor';
export { runAsk, type AskEvent } from './agents/ask';
export { runMarketAgent } from './agents/market';
export { runHoldersAgent } from './agents/holders';
export { runNewsAgent } from './agents/news';
export { runSynthesis } from './agents/synthesis';
export { getProvider, resetProvider } from './providers/index';
export { extractJson } from './providers/types';
export type { LLMProvider, ProviderName, CompleteOpts, CompleteResult } from './providers/types';
export { registry as mcpRegistry } from './mcp/registry';
export type { DataFeed, MCPServerConfig } from './mcp/types';
export { openSse } from './sse';
export { byokProvider, type AgentRouting } from './providers/byok';
export { makeAnthropicProvider } from './providers/anthropic';
export { makeOpenAIProvider } from './providers/openai';
export { makeGoogleProvider } from './providers/google';
export { makePerplexityProvider } from './providers/perplexity';
export { makeXAIProvider } from './providers/xai';
export { runSentimentAgent } from './agents/sentiment';
export { runThesisAgent } from './agents/thesis';

// BYOK header shape — used by the apps/server byokHeader middleware as a
// type-only import. Defined here so callers can import it without dragging
// the provider factories in.
export type BYOKHeaders = {
  primary?: string;
  primaryKey?: string;
  perplexityKey?: string;
  xaiKey?: string;
};
