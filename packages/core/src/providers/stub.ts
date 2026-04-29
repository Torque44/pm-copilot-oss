// Stub provider — returns canned text without hitting any external API.
//
// Used by `pnpm smoke` so CI can boot the server, hit /api/health, and exit
// with a non-zero status if anything is wired wrong, all without keys or
// network access. Selected via PROVIDER=stub.

import type {
  CompleteOpts,
  CompleteResult,
  LLMProvider,
  ProviderCapabilities,
} from './types';

const CAPS: ProviderCapabilities = {
  nativeJsonMode: false,
  webSearch: false,
  authViaSession: false,
};

const CANNED_JSON = JSON.stringify({
  claims: [{ text: 'stub provider — no llm reachable.', citations: [] }],
  citations: [],
});

export class StubProvider implements LLMProvider {
  // ProviderName union excludes 'stub'; cast structurally for tests.
  readonly name = 'stub' as 'anthropic';
  readonly capabilities: ProviderCapabilities = CAPS;

  async complete(_prompt: string, opts: CompleteOpts = {}): Promise<CompleteResult> {
    const started = Date.now();
    const text = opts.jsonOnly ? CANNED_JSON : 'ok';
    return {
      ok: true,
      text,
      elapsedMs: Date.now() - started,
      model: opts.model ?? 'stub',
      provider: 'stub' as 'anthropic',
    };
  }
}
