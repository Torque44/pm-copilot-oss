// OpenAI provider — Chat Completions API. Supports both standard OpenAI
// (api.openai.com) and Azure OpenAI Service.
//
// Mode is detected from env vars at construction time:
//   - OPENAI_API_VERSION set      → Azure mode (api-key header, deployments URL)
//   - OPENAI_API_VERSION unset    → vanilla OpenAI (Bearer header, /v1)
//
// Azure mode env vars:
//   OPENAI_BASE_URL          https://<resource>.openai.azure.com
//   OPENAI_API_VERSION       e.g. 2024-12-01-preview
//   OPENAI_REASONING_MODEL   Azure deployment name (NOT the model family) for the
//                            reasoning tier (default 'gpt-5'). In Azure-OpenAI the
//                            URL embeds the deployment name; the request body's
//                            `model` field is ignored but harmless.
//   OPENAI_FAST_MODEL        deployment name for the fast tier (default 'gpt-5-mini')
//
// JSON mode is true-native via response_format on standard OpenAI. Azure OpenAI
// for newer reasoning models (gpt-5+) silently ignores unknown fields.

import pLimit from 'p-limit';
import type {
  CompleteOpts,
  CompleteResult,
  LLMProvider,
  ProviderCapabilities,
} from './types';
import { sanitizeUpstreamErrorBody } from './sanitizeError';

const briefLimit = pLimit(4);
const askLimit = pLimit(2);

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_REASONING_MODEL = 'gpt-5';
const DEFAULT_FAST_MODEL = 'gpt-5-mini';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;
  readonly capabilities: ProviderCapabilities = {
    nativeJsonMode: true,
    webSearch: false,
    authViaSession: false,
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly azureApiVersion: string | null;
  private readonly reasoningModel: string;
  private readonly fastModel: string;

  constructor(opts?: { apiKey?: string | null }) {
    const k = opts?.apiKey || process.env.OPENAI_API_KEY;
    if (!k) {
      throw new Error(
        'OpenAIProvider: OPENAI_API_KEY env var or x-llm-key header required.'
      );
    }
    this.apiKey = k;
    this.baseUrl = process.env.OPENAI_BASE_URL?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1';
    this.azureApiVersion = process.env.OPENAI_API_VERSION?.trim() || null;
    this.reasoningModel = process.env.OPENAI_REASONING_MODEL?.trim() || DEFAULT_REASONING_MODEL;
    this.fastModel = process.env.OPENAI_FAST_MODEL?.trim() || DEFAULT_FAST_MODEL;
  }

  private tierToModel(tier: 'fast' | 'reasoning'): string {
    return tier === 'reasoning' ? this.reasoningModel : this.fastModel;
  }

  private buildUrl(deployment: string): string {
    if (this.azureApiVersion) {
      // Azure: https://<endpoint>/openai/deployments/<name>/chat/completions?api-version=<ver>
      return `${this.baseUrl}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(this.azureApiVersion)}`;
    }
    return `${this.baseUrl}/chat/completions`;
  }

  private buildAuthHeaders(): Record<string, string> {
    if (this.azureApiVersion) {
      return { 'api-key': this.apiKey };
    }
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async complete(prompt: string, opts: CompleteOpts = {}): Promise<CompleteResult> {
    const pool = opts.lane === 'ask' ? askLimit : briefLimit;
    return pool(async () => {
      const started = Date.now();
      const model = opts.model ?? this.tierToModel(opts.tier ?? 'reasoning');
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

      // GPT-5+ / o-series reasoning models support `reasoning_effort` and
      // `verbosity`. Default-medium reasoning at the brief scale costs us
      // 10-30s per call, so we bias hard toward speed:
      //   - fast tier   → reasoning_effort: 'none'   (no thinking, fastest)
      //   - reasoning   → reasoning_effort: 'low'    (a bit of thinking)
      // GPT-5.5 specifically accepts: none, low, medium, high, xhigh.
      // Older deployments (gpt-4o etc.) ignore unknown fields silently.
      // We gate on Azure mode because OpenAI's public endpoint validates
      // unknown fields more strictly than Azure.
      if (this.azureApiVersion) {
        const tier = opts.tier ?? 'reasoning';
        body.reasoning_effort = tier === 'fast' ? 'none' : 'low';
        body.verbosity = 'low';
      }

      const ctrl = new AbortController();
      const killer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(this.buildUrl(model), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.buildAuthHeaders(),
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(killer);
        if (!r.ok) {
          const errText = await r.text().catch(() => '');
          // Redact any key fragments an upstream gateway / Azure validation
          // page might have echoed back, then truncate. Otherwise the body
          // can flow into logs, the persisted brief envelope, and the
          // auth-test response.
          return {
            ok: false,
            text: '',
            error: `openai ${r.status}: ${sanitizeUpstreamErrorBody(errText, 500)}`,
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
