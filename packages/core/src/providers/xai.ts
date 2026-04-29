// xAI / Grok provider.
//
// Used as: (a) primary provider when PROVIDER=xai, (b) Sentiment agent
// specialist regardless of primary. Grok has X-native data via xAI's
// platform; that's why Sentiment needs it specifically.
//
// API surface: OpenAI-compatible Chat Completions at https://api.x.ai/v1.
// Docs: https://docs.x.ai/api

import type {
  CompleteOpts,
  CompleteResult,
  LLMProvider,
  ProviderCapabilities,
} from './types';

const BASE = process.env['XAI_BASE_URL'] || 'https://api.x.ai/v1';

function tierToModel(tier: 'fast' | 'reasoning'): string {
  return tier === 'reasoning' ? 'grok-3' : 'grok-3-mini';
}

const CAPS: ProviderCapabilities = {
  nativeJsonMode: true,
  webSearch: true,
  authViaSession: false,
};

export function makeXAIProvider(apiKey?: string | null): LLMProvider {
  const key = apiKey || process.env['XAI_API_KEY'] || '';
  return {
    name: 'xai' as 'perplexity', // structural — ProviderName union doesn't include 'xai' yet; cast keeps shape compatible
    capabilities: CAPS,
    async complete(prompt: string, opts: CompleteOpts = {}): Promise<CompleteResult> {
      const started = Date.now();
      const model = opts.model ?? tierToModel(opts.tier ?? 'fast');
      const timeoutMs = opts.timeoutMs ?? 60_000;

      if (!key) {
        return {
          ok: false,
          text: '',
          error: 'xAI not configured: set XAI_API_KEY or pass via x-xai-key header',
          model,
          elapsedMs: Date.now() - started,
          provider: 'xai' as 'perplexity',
        };
      }

      let system = opts.systemPrompt ?? '';
      if (opts.jsonOnly) {
        const j =
          'Respond with ONLY a JSON object matching the requested shape. No prose, no markdown fences, no commentary.';
        system = system ? `${system}\n\n${j}` : j;
      }
      const messages: { role: string; content: string }[] = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      const body: Record<string, unknown> = { model, messages, temperature: 0.2 };
      if (opts.jsonOnly) body['response_format'] = { type: 'json_object' };

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      try {
        const res = await fetch(`${BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          return {
            ok: false,
            text: '',
            error: `xAI HTTP ${res.status}: ${detail.slice(0, 300)}`,
            model,
            elapsedMs: Date.now() - started,
            provider: 'xai' as 'perplexity',
          };
        }

        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = String(json.choices?.[0]?.message?.content ?? '').trim();
        return {
          ok: true,
          text,
          model,
          elapsedMs: Date.now() - started,
          provider: 'xai' as 'perplexity',
        };
      } catch (err) {
        clearTimeout(timer);
        const msg =
          err instanceof Error && err.name === 'AbortError'
            ? `timeout after ${timeoutMs}ms`
            : err instanceof Error
              ? err.message
              : String(err);
        return {
          ok: false,
          text: '',
          error: `xAI fetch error: ${msg}`,
          model,
          elapsedMs: Date.now() - started,
          provider: 'xai' as 'perplexity',
        };
      }
    },
  };
}
