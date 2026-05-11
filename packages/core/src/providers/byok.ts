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
/** Auto-detect a primary provider name from server env vars, applied as the
 *  last-resort default when neither headers.primary nor process.env.PROVIDER
 *  is set. Matches the client-side orchestrator rank so behaviour is
 *  consistent on both sides. Without this, a hosted deploy with only
 *  OPENAI_API_KEY set (and no explicit PROVIDER var) would silently default
 *  to 'anthropic' and fail every request — a real footgun for future
 *  redeploys. */
function sniffEnvPrimary(): string | null {
  if (process.env['ANTHROPIC_API_KEY']) return 'anthropic';
  if (process.env['GOOGLE_API_KEY'] || process.env['GEMINI_API_KEY']) return 'google';
  if (process.env['OPENAI_API_KEY']) return 'openai';
  if (process.env['XAI_API_KEY']) return 'xai';
  return null;
}

export function byokProvider(headers: BYOKHeaders): AgentRouting {
  const primaryName =
    headers.primary || process.env['PROVIDER'] || sniffEnvPrimary() || 'anthropic';
  const primary = makeOneProvider(primaryName, headers.primaryKey);

  const perplexityKey = headers.perplexityKey || process.env['PERPLEXITY_API_KEY'] || null;
  const news = perplexityKey ? makePerplexityProvider(perplexityKey) : primary;

  // Sentiment requires xAI (live X search). Resolve in priority order:
  //   1. Explicit `xaiKey` from the "xai (sentiment only)" setup tile.
  //   2. The primary key, IF the user picked "xai (primary)" — that tile's
  //      copy says "primary reasoning + sentiment" so the same key has to
  //      serve both roles. Without this fallback the tile's promise was a lie
  //      (sentiment dot stuck on `pending` forever despite "✓ connected").
  //   3. Server-side env var (self-host mode).
  let xaiKey: string | null = headers.xaiKey ?? null;
  if (!xaiKey && (primaryName === 'xai' || primaryName === 'grok') && headers.primaryKey) {
    xaiKey = headers.primaryKey;
  }
  if (!xaiKey) xaiKey = process.env['XAI_API_KEY'] || null;
  const sentiment = xaiKey ? makeXAIProvider(xaiKey) : null;

  return { primary, news, sentiment };
}

/** Pick the best provider for ad-hoc questions (used by the ask agent).
 *  Priority: a web-search-capable provider if any are configured, else null
 *  so the caller falls back to the routing.primary via getProvider().
 *
 *  Order matters: news (perplexity if user paid for it) wins over sentiment
 *  (xai with live_search) — Perplexity Sonar is purpose-built for grounded
 *  web answers and is faster for factual questions. xAI Grok is a strong
 *  fallback when no Perplexity key is present.
 */
export function bestWebSearchProvider(routing: AgentRouting): LLMProvider | null {
  if (routing.news.capabilities?.webSearch) return routing.news;
  if (routing.sentiment?.capabilities?.webSearch) return routing.sentiment;
  return null;
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
