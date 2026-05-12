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
import { sanitizeUpstreamErrorBody } from './sanitizeError';

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

      const buildBody = (withSearch: boolean): Record<string, unknown> => {
        const b: Record<string, unknown> = { model, messages, temperature: 0.2 };
        if (opts.jsonOnly) b['response_format'] = { type: 'json_object' };
        if (withSearch && opts.liveSearch && opts.liveSearch.mode !== 'off') {
          // xAI Live Search payload shape (current as of 2026):
          //   search_parameters: {
          //     mode, return_citations, max_search_results, from_date, to_date,
          //     sources: [{type:'x', x_handles:[...]} | {type:'web'} | {type:'news'}]
          //   }
          // Docs: https://docs.x.ai/docs/guides/live-search
          const ls = opts.liveSearch;
          const sourceTypes = ls.sources ?? ['x', 'web', 'news'];
          const sources: Array<Record<string, unknown>> = [];
          for (const t of sourceTypes) {
            if (t === 'x') {
              const xSrc: Record<string, unknown> = { type: 'x' };
              if (ls.xHandles && ls.xHandles.length) {
                // xAI caps x_handles at 25 per request; sanitise (no @, no spaces)
                xSrc['x_handles'] = ls.xHandles
                  .slice(0, 25)
                  .map((h) => h.replace(/^@/, '').trim())
                  .filter(Boolean);
              }
              sources.push(xSrc);
            } else if (t === 'web') {
              sources.push({ type: 'web' });
            } else if (t === 'news') {
              sources.push({ type: 'news' });
            }
          }
          const sp: Record<string, unknown> = {
            mode: ls.mode,
            return_citations: ls.returnCitations ?? true,
            sources,
          };
          if (typeof ls.maxResults === 'number') sp['max_search_results'] = ls.maxResults;
          if (typeof ls.fromDays === 'number' && ls.fromDays > 0) {
            const from = new Date(Date.now() - ls.fromDays * 86_400_000);
            sp['from_date'] = from.toISOString().slice(0, 10);
            sp['to_date'] = new Date().toISOString().slice(0, 10);
          }
          b['search_parameters'] = sp;
        }
        return b;
      };

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      const fetchOnce = async (withSearch: boolean): Promise<Response> => {
        return fetch(`${BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(buildBody(withSearch)),
          signal: ctrl.signal,
        });
      };

      const warnings: string[] = [];
      try {
        const wantedSearch = !!opts.liveSearch && opts.liveSearch.mode !== 'off';
        let res = await fetchOnce(wantedSearch);
        // If xAI deprecates search_parameters again, retry once without it.
        // 410 Gone = endpoint dropped that field; 400 with "search" keyword =
        // shape error. In either case, base completion still works — but the
        // user asked for live web/X search and we silently degraded to the
        // model's training memory. Surface that as a warning so callers can
        // emit agent:warning and the UI can flag the section as "stale".
        if (wantedSearch && (res.status === 410 || res.status === 400)) {
          const peek = await res.clone().text().catch(() => '');
          if (/search/i.test(peek) || res.status === 410) {
            // Log occurrence + status only — do NOT echo the response body.
            // Gateway error pages occasionally include auth-header context,
            // and stdout logs land in Render/Azure container logs in plain
            // text. The body is preserved in the `warnings` array that
            // flows back to the client for UX surfacing (see news/sentiment
            // agents' agent:warning paths).
            console.warn(
              `[xai] live-search rejected (HTTP ${res.status}) — retrying without search_parameters`,
            );
            warnings.push(
              `xai-live-search-disabled: live web/X search rejected by xAI (HTTP ${res.status}); answer is grounded in the model's training data, not real-time sources`,
            );
            res = await fetchOnce(false);
          }
        }
        clearTimeout(timer);

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          // Redact key fragments before the body lands in result.error
          // (which can flow into logs, persisted briefs, auth-test).
          return {
            ok: false,
            text: '',
            error: `xAI HTTP ${res.status}: ${sanitizeUpstreamErrorBody(detail, 300)}`,
            model,
            elapsedMs: Date.now() - started,
            provider: 'xai' as 'perplexity',
          };
        }

        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          citations?: unknown;
        };
        const text = String(json.choices?.[0]?.message?.content ?? '').trim();
        // xAI returns citations either as a flat string[] or {url, type}[]
        // depending on API version. Normalise to string[] of URLs.
        const rawCitations = Array.isArray(json.citations) ? json.citations : [];
        const citations = rawCitations
          .map((c): string | null => {
            if (typeof c === 'string') return c;
            if (c && typeof c === 'object') {
              const o = c as { url?: unknown };
              if (typeof o.url === 'string') return o.url;
            }
            return null;
          })
          .filter((c): c is string => !!c);
        return {
          ok: true,
          text,
          model,
          elapsedMs: Date.now() - started,
          provider: 'xai' as 'perplexity',
          citations,
          ...(warnings.length ? { warnings } : {}),
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
