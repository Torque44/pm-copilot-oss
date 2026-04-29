// Google (Gemini) provider — generateContent REST API.
//
// Uses fetch directly. Reads GOOGLE_API_KEY (or GEMINI_API_KEY as fallback).
// JSON mode is set via responseMimeType: "application/json".

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
  return tier === 'reasoning' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
}

export class GoogleProvider implements LLMProvider {
  readonly name = 'google' as const;
  readonly capabilities: ProviderCapabilities = {
    nativeJsonMode: true,
    webSearch: false,
    authViaSession: false,
  };

  private readonly apiKey: string;

  constructor(opts?: { apiKey?: string | null }) {
    const k = opts?.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!k) {
      throw new Error(
        'GoogleProvider: GOOGLE_API_KEY (or GEMINI_API_KEY) env var or x-llm-key header required.'
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

      const generationConfig: Record<string, unknown> = {};
      if (opts.jsonOnly) {
        generationConfig.responseMimeType = 'application/json';
      }

      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      };
      if (opts.systemPrompt) {
        body.systemInstruction = { parts: [{ text: opts.systemPrompt }] };
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

      const ctrl = new AbortController();
      const killer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(killer);
        if (!r.ok) {
          const errText = await r.text().catch(() => '');
          return {
            ok: false,
            text: '',
            error: `gemini ${r.status}: ${errText.slice(0, 500)}`,
            elapsedMs: Date.now() - started,
            model,
            provider: 'google',
          };
        }
        const data = (await r.json()) as any;
        const text = String(
          data?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p?.text ?? '')
            .join('') ?? ''
        ).trim();
        return {
          ok: true,
          text,
          elapsedMs: Date.now() - started,
          model,
          provider: 'google',
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
          provider: 'google',
        };
      }
    });
  }
}

export function makeGoogleProvider(apiKey?: string | null): LLMProvider {
  return new GoogleProvider({ apiKey });
}
