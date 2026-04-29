// Provider factory.
//
// Selection precedence:
//   1. Explicit PROVIDER env var (anthropic | openai | google | perplexity).
//   2. Default: 'anthropic' (with Claude Code subprocess auth as zero-config fallback).
//
// First call to getProvider() instantiates the provider singleton. Subsequent
// calls return the cached instance. Use resetProvider() in tests to clear it.

import type { LLMProvider, ProviderName } from './types';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GoogleProvider } from './google';
import { PerplexityProvider } from './perplexity';
import { StubProvider } from './stub';

export type { LLMProvider, ProviderName, CompleteOpts, CompleteResult } from './types';
export { extractJson } from './types';

let cached: LLMProvider | null = null;

const KNOWN: ProviderName[] = ['anthropic', 'openai', 'google', 'perplexity'];

function pickName(): ProviderName | 'stub' {
  const raw = (process.env.PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'stub') return 'stub';
  if (raw && (KNOWN as string[]).includes(raw)) return raw as ProviderName;
  // Treat 'gemini' as a friendly alias for 'google'.
  if (raw === 'gemini') return 'google';
  return 'anthropic';
}

export function getProvider(): LLMProvider {
  if (cached) return cached;
  const name = pickName();
  switch (name) {
    case 'anthropic':
      cached = new AnthropicProvider();
      break;
    case 'openai':
      cached = new OpenAIProvider();
      break;
    case 'google':
      cached = new GoogleProvider();
      break;
    case 'perplexity':
      cached = new PerplexityProvider();
      break;
    case 'stub':
      cached = new StubProvider();
      break;
  }
  if (!cached) {
    throw new Error(`Unknown PROVIDER: ${name}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[pm-copilot] provider=${cached.name} (auth via ${
      cached.capabilities.authViaSession ? 'local session' : 'API key'
    }, webSearch=${cached.capabilities.webSearch}, nativeJsonMode=${cached.capabilities.nativeJsonMode})`
  );
  return cached;
}

export function resetProvider(): void {
  cached = null;
}
