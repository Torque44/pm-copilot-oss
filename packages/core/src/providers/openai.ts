// OpenAI provider — Chat Completions API.
//
// Uses fetch directly (no SDK dependency) to keep the provider footprint thin.
// Reads OPENAI_API_KEY from env. Optional OPENAI_BASE_URL override (for
// Azure OpenAI / proxies). JSON mode is true-native via response_format.

import pLimit from 'p-limit';
import type {
  CompleteOpts,
  CompleteResult,
  LLMProvider,
  ProviderCapabilities,
} from './types';

const briefLimit = pLimit(4);
const askLimit = pLimit(2);

const DEFAULT_TIMEOUT_MS = 30_000;

function tierToModel(tier: 'fast' | 'reasoning'): string {
  return tier === 'reasoning' ? 'gpt-5' : 'gpt-5-mini';
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;
  readonly capabilities: ProviderCapabilities = {
    nativeJsonMode: true,
    webSearch: false,
    authViaSession: false,
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts?: { apiKey?: string | null }) {
    const k = opts?.apiKey || process.env.OPENAI_API_KEY;
    if (!k) {
      throw new Error(
        'OpenAIProvider: OPENAI_API_KEY env var or x-llm-key header required.'
      );
    }
    this.apiKey = k;
    this.baseUrl = process.env.OPENAI_BASE_URL?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1';
  }

  async complete(prompt: string, opts: CompleteOpts = {}): Promise<CompleteResult> {
    const pool = opts.lane === 'ask' ? askLimit : briefLimit;
    return pool(async () => {
      const started = Date.now();
      const model = opts.model ?? tierToModel(opts.tier ?? 'reasoning');
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const messages: { role: string; content: string }[] = [];
      if (opts.systemPrompt) {
        messages.push({ role: 'system', content: opts.systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const body: Record<string, unknown> = {
        model,
        messages,
      };
      if (opts.jsonOnly) {
        body.response_format = { type: 'json_object' };
      }

      const ctrl = new AbortController();
      const killer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(`${this.baseUrl}/chat/completions`, {
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
            error: `openai ${r.status}: ${errText.slice(0, 500)}`,
            elapsedMs: Date.now() - started,
            model,
            provider: 'openai',
          };
        }
        const data = (await r.json()) as any;
        const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
        return {
          ok: true,
          text,
          elapsedMs: Date.now() - started,
          model,
          provider: 'openai',
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
          provider: 'openai',
        };
      }
    });
  }
}

export function makeOpenAIProvider(apiKey?: string | null): LLMProvider {
  return new OpenAIProvider({ apiKey });
}
