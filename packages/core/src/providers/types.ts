// Provider abstraction layer.
//
// Every LLM backend (Anthropic, OpenAI, Gemini, Perplexity) implements this
// minimal interface. Surface is deliberately small: a single text-completion
// call with an optional system prompt, optional JSON-only mode, and a timeout.
//
// Streaming, vision, tool-use, embeddings — all out of scope. The kernel is a
// JSON-extraction pipeline; that's all the providers need to support.

export type ProviderName = 'anthropic' | 'openai' | 'google' | 'perplexity';

export type ProviderTier = 'fast' | 'reasoning';

/** Concurrency lane.
 *  - 'brief' — shared by Market/Holders/News/Synthesis specialists during a brief run (4-slot pool).
 *  - 'ask'   — dedicated to interactive Q&A so it never queues behind a brief synthesis (2-slot pool).
 */
export type Lane = 'brief' | 'ask';

export type CompleteOpts = {
  /** Logical model tier. The provider maps this to a concrete model id. */
  tier?: ProviderTier;
  /** Concrete provider-specific model id override. Wins over `tier`. */
  model?: string;
  /** System prompt prepended to the request. */
  systemPrompt?: string;
  /** When true, instructs the provider to return JSON only (no prose, no fences). */
  jsonOnly?: boolean;
  /** Hard timeout in milliseconds. */
  timeoutMs?: number;
  /** Concurrency lane. Default 'brief'. */
  lane?: Lane;
  /** Optional list of tool names this provider should allow (e.g. ['WebSearch']).
   *  Most providers ignore this. The Anthropic-via-Claude-Code path uses it to
   *  pass `--allowedTools` so a specialist (e.g. NewsAgent) can run web search. */
  allowedTools?: string[];
  /** Live-search opts. Today only the xAI/Grok provider honours these — Grok
   *  has X + web + news search baked into its API. Other providers ignore. */
  liveSearch?: {
    /** 'on' forces search every call; 'auto' lets Grok decide; 'off' disables. */
    mode: 'on' | 'auto' | 'off';
    /** Source channels. Default ['x','web','news'] when sources omitted. */
    sources?: Array<'x' | 'web' | 'news'>;
    /** Time window — only consider sources from the last N days. */
    fromDays?: number;
    /** Maximum search results to fold into the answer. */
    maxResults?: number;
    /** Ask Grok to attach `citations` array (URLs) to its response. */
    returnCitations?: boolean;
  };
};

export type CompleteResult = {
  /** Raw text returned by the model (may include JSON, may include fences). */
  text: string;
  /** True if the call completed without timeout / transport error. */
  ok: boolean;
  /** When ok=false, a short error string (timeout, 4xx, etc.). */
  error?: string;
  /** Wall-clock time from start of call to completion. */
  elapsedMs: number;
  /** Concrete model id that handled the call. */
  model: string;
  /** Provider that served the call (informational). */
  provider: ProviderName;
  /** Source URLs the provider used during a live-search call. xAI/Grok
   *  attaches these when search_parameters.return_citations=true. */
  citations?: string[];
};

export interface ProviderCapabilities {
  /** Whether this provider has a true JSON-mode (vs prompt-coercion). */
  nativeJsonMode: boolean;
  /** Whether this provider can perform live web search. */
  webSearch: boolean;
  /** Whether this provider was authenticated via local OAuth/session
   *  (vs an explicit API key). Informational; surfaced by the factory. */
  authViaSession: boolean;
}

export interface LLMProvider {
  /** Stable provider identifier. */
  readonly name: ProviderName;
  /** Capability flags (used by callers to gate features). */
  readonly capabilities: ProviderCapabilities;

  /** Issue a single text completion. */
  complete(prompt: string, opts?: CompleteOpts): Promise<CompleteResult>;
}

/** Extract the first JSON object/array from a blob of text.
 *  Handles ```json fences and prose wrappers. Shared utility used by all
 *  providers that don't have a true JSON mode. */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1]) as T;
    } catch {
      /* fall through */
    }
  }
  const firstBrace = minIndex(text.indexOf('{'), text.indexOf('['));
  if (firstBrace < 0) return null;
  const openChar = text[firstBrace];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        continue;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        const slice = text.slice(firstBrace, i + 1);
        try {
          return JSON.parse(slice) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function minIndex(a: number, b: number): number {
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}
