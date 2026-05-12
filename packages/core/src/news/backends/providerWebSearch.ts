// providerWebSearch.ts — third (last) backend in the news chain. Uses the
// user's primary provider when it advertises capabilities.webSearch
// (Perplexity natively, Anthropic-CC via tool access). Sends a minimal
// "news about X, return JSON" prompt.
//
// This is billable (user paid for the key) so it's last — only invoked
// when Exa + Polymarket comments both came up empty. The retry policy
// applies inside the LLM provider; we don't double-retry here.

import { extractJson } from '../../providers/types';
import type { LLMProvider } from '../../providers/types';
import type { SearchBackend, NewsHit, SearchOpts } from '../types';

type ProviderResp = {
  items?: Array<{
    url?: string;
    title?: string;
    source?: string;
    publishedAt?: string;
    snippet?: string;
  }>;
};

export function makeProviderWebSearchBackend(
  getProvider: () => LLMProvider | null,
): SearchBackend {
  return {
    name: 'provider-web',
    available: () => {
      const p = getProvider();
      return p != null && p.capabilities.webSearch;
    },
    async search(query: string, opts: SearchOpts): Promise<NewsHit[]> {
      const provider = getProvider();
      if (!provider || !provider.capabilities.webSearch) return [];

      const sysPrompt = `You are a news researcher. Use web search to find recent news about the user's query. Return JSON ONLY:
{
  "items": [
    {
      "url": "<full url from real search>",
      "title": "<headline>",
      "source": "<domain>",
      "publishedAt": "<ISO date>",
      "snippet": "<1-2 sentences>"
    }
  ]
}
Rules: only include items with a real URL and a real publishedAt date. NEVER fabricate. If web search returns nothing relevant, return items: [].`;

      const prompt = `Search the web for news about: "${opts.marketTitle}"
Search window: ${opts.windowStart} → ${opts.windowEnd}
Query: ${query}

Return the JSON.`;

      const res = await provider.complete(prompt, {
        tier: 'fast',
        systemPrompt: sysPrompt,
        allowedTools: ['WebSearch'],
        jsonOnly: true,
        timeoutMs: 60_000,
      });

      if (!res.ok) return [];
      const parsed = extractJson<ProviderResp>(res.text);
      if (!parsed || !Array.isArray(parsed.items)) return [];

      return parsed.items
        .filter((it): it is { url: string; title?: string; source?: string; publishedAt: string; snippet?: string } =>
          Boolean(it.url) && Boolean(it.publishedAt),
        )
        .map((it): NewsHit => ({
          url: it.url,
          title: it.title ?? '',
          source: it.source ?? safeDomain(it.url),
          publishedAt: it.publishedAt,
          snippet: it.snippet ?? '',
        }));
    },
  };
}

function safeDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
