// Perplexity provider — Sonar API (OpenAI-compatible Chat Completions).
//
// Reads PERPLEXITY_API_KEY from env. Distinct from OpenAI because Perplexity's
// Sonar models bake live web search into the response — useful for the News
// specialist when the user has no Claude-Code WebSearch path.

import pLimit from 'p-limit';
import type {
  CompleteOpts,
  CompleteResult,
  LLMProvider,
  ProviderCapabilities,
} from './types';

const briefLimit = pLimit(4);
const askLimit = pLimit(2);

const DEFAULT_TIMEOUT_MS = 60_000;

function tierToModel(tier: 'fast' | 'reasoning'): string {
  return tier === 'reasoning' ? 'sonar-pro' : 'sonar';
}

export class PerplexityProvider implements LLMProvider {
  readonly name = 'perplexity' as const;
  readonly capabilities: ProviderCapabilities = {
    nativeJsonMode: false,
    webSearch: true,
    authViaSession: false,
  };

  private readonly apiKey: string;

  constructor(opts?: { apiKey?: string | null }) {
    const k = opts?.apiKey || process.env.PERPLEXITY_API_KEY;
    if (!k) {
      throw new Error(
        'PerplexityProvider: PERPLEXITY_API_KEY env var or x-llm-key/x-perplexity-key header required.'
      );
    }
    this.apiKey = k;
  }

  async complete(prompt: string, opts: CompleteOpts = {}): Promise<CompleteResult> {
    const pool = opts.lane === 'ask' ? askLimit : briefLimit;
    return pool(async () => {
      const started = Date.now();
      const model = opts.model ?? tierToModel(opts.tier ?? 'reasoning');
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      let system = opts.systemPrompt ?? '';
      if (opts.jsonOnly) {
        const j =
          'Respond with ONLY a JSON object matching the requested shape. No prose, no markdown fences, no commentary.';
        system = system ? `${system}\n\n${j}` : j;
      }

      const messages: { role: string; content: string }[] = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      const body: Record<string, unknown> = { model, messages };

      const ctrl = new AbortController();
      const killer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(killer);
        if (!r.ok) {
          const errText = await r.text().catch(() => '');
          return {
            ok: false,
            text: '',
            error: `perplexity ${r.status}: ${errText.slice(0, 500)}`,
            elapsedMs: Date.now() - started,
            model,
            provider: 'perplexity',
          };
        }
        const data = (await r.json()) as any;
        const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
        return {
          ok: true,
          text,
          elapsedMs: Date.now() - started,
          model,
          provider: 'perplexity',
        };
      } catch (err: any) {
        clearTimeout(killer);
        const msg = err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err?.message ?? 'fetch failed';
        return {
          ok: false,
          text: '',
          error: msg,
          elapsedMs: Date.now() - started,
          model,
          provider: 'perplexity',
        };
      }
    });
  }
}

export function makePerplexityProvider(apiKey?: string | null): LLMProvider {
  return new PerplexityProvider({ apiKey });
}
