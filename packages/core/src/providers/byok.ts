// Bring-Your-Own-Key provider config.
//
// Beta hosted-instance mode: keys travel from browser → server via per-request
// header (`x-llm-key`, `x-llm-provider`, optional `x-perplexity-key`,
// `x-xai-key`). Server NEVER persists, NEVER logs. byokProvider() returns a
// per-request LLMProvider that wraps the appropriate underlying impl.
//
// In self-host mode, env-var keys take precedence and this layer is a no-op.

import type { LLMProvider } from './types';
import { makeAnthropicProvider } from './anthropic';
import { makeOpenAIProvider } from './openai';
import { makeGoogleProvider } from './google';
import { makePerplexityProvider } from './perplexity';
import { makeXAIProvider } from './xai';

export type BYOKHeaders = {
  primary?: string; // 'anthropic' | 'openai' | 'google' | 'perplexity'
  primaryKey?: string;
  perplexityKey?: string; // for News agent enhancement
  xaiKey?: string; // for Sentiment agent
};

export type AgentRouting = {
  primary: LLMProvider;
  news: LLMProvider; // perplexity if configured, else primary
  sentiment: LLMProvider | null; // xai required; null if not configured
};

/**
 * Build a per-agent provider routing from BYOK headers (or env fallbacks).
 *
 * Called once per /api/brief or /api/ask request. Result lives only for the
 * lifetime of the request — no server-side persistence.
 */
export function byokProvider(headers: BYOKHeaders): AgentRouting {
  const primaryName = headers.primary || process.env['PROVIDER'] || 'anthropic';
  const primary = makeOneProvider(primaryName, headers.primaryKey);

  const perplexityKey = headers.perplexityKey || process.env['PERPLEXITY_API_KEY'] || null;
  const news = perplexityKey ? makePerplexityProvider(perplexityKey) : primary;

  const xaiKey = headers.xaiKey || process.env['XAI_API_KEY'] || null;
  const sentiment = xaiKey ? makeXAIProvider(xaiKey) : null;

  return { primary, news, sentiment };
}

function makeOneProvider(name: string, apiKey?: string): LLMProvider {
  switch (name) {
    case 'anthropic':
    case 'anthropic-cc':
      return makeAnthropicProvider(apiKey);
    case 'openai':
      return makeOpenAIProvider(apiKey);
    case 'google':
    case 'gemini':
      return makeGoogleProvider(apiKey);
    case 'perplexity':
      return makePerplexityProvider(apiKey);
    case 'xai':
    case 'grok':
      return makeXAIProvider(apiKey);
    default:
      throw new Error(`unknown provider: ${name}`);
  }
}
