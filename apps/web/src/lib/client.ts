// client.ts — thin fetch wrapper that auto-attaches BYOK headers.
//
// All BYOK keys live in cryptoStorage (IndexedDB AES-GCM). Each call reads
// presence + plaintext on demand; once decrypted the master key is cached in
// memory by cryptoStorage so repeat reads are cheap. Set `skipBYOK: true`
// to opt out (e.g., the auth-test endpoint where we pass keys in the body).
//
// SSE endpoint note: EventSource cannot send custom headers. For
// /api/brief?marketId=X the BYOK fallback is to attach the relevant key as
// query params (?provider=…&key=…). buildBriefSSEUrl() returns just the URL
// today; the server side can read either the headers (set by middleware) or
// fall back to query params when the request comes from EventSource.

import type { ProviderName } from '../types';
import { getSecret } from './cryptoStorage';

const SECRET_KEY_PRIMARY = 'byok:primary';
const SECRET_KEY_PRIMARY_PROVIDER = 'byok:primary:provider';
const SECRET_KEY_PERPLEXITY = 'byok:perplexity';
const SECRET_KEY_XAI = 'byok:xai';

export type ApiRequestOpts = RequestInit & { skipBYOK?: boolean };

export type ApiError = {
  status: number;
  body: unknown;
  message: string;
};

function isApiError(x: unknown): x is ApiError {
  return !!x && typeof x === 'object' && 'status' in x && 'body' in x;
}

async function loadByokHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  try {
    const [primary, primaryProvider, perplexity, xai] = await Promise.all([
      getSecret(SECRET_KEY_PRIMARY),
      getSecret(SECRET_KEY_PRIMARY_PROVIDER),
      getSecret(SECRET_KEY_PERPLEXITY),
      getSecret(SECRET_KEY_XAI),
    ]);
    if (primary) headers['x-llm-key'] = primary;
    if (primaryProvider) headers['x-llm-provider'] = primaryProvider;
    if (perplexity) headers['x-perplexity-key'] = perplexity;
    if (xai) headers['x-xai-key'] = xai;
  } catch {
    // BYOK is best-effort — if cryptoStorage fails we just send no headers.
  }
  return headers;
}

function mergeHeaders(base: HeadersInit | undefined, extra: Record<string, string>): Headers {
  const h = new Headers(base);
  for (const [k, v] of Object.entries(extra)) {
    if (!h.has(k)) h.set(k, v);
  }
  return h;
}

export async function apiFetch(path: string, opts: ApiRequestOpts = {}): Promise<Response> {
  const { skipBYOK, headers: rawHeaders, body: rawBody, ...rest } = opts;
  const byokHeaders = skipBYOK ? {} : await loadByokHeaders();
  const headers = mergeHeaders(rawHeaders, byokHeaders);

  let body = rawBody;
  if (
    body !== undefined &&
    body !== null &&
    typeof body === 'object' &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof URLSearchParams) &&
    !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  ) {
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }

  const init: RequestInit = { ...rest, headers };
  if (body !== undefined) init.body = body as BodyInit;

  const res = await fetch(path, init);
  return res;
}

export async function apiJSON<T>(path: string, opts: ApiRequestOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  const res = await apiFetch(path, { ...opts, headers });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      body: parsed,
      message: `HTTP ${res.status} ${res.statusText} for ${path}`,
    };
    throw err;
  }
  return parsed as T;
}

export async function authTest(
  provider: ProviderName,
  key: string,
): Promise<{ ok: boolean; model?: string; error?: string; elapsedMs?: number }> {
  try {
    return await apiJSON<{ ok: boolean; model?: string; error?: string; elapsedMs?: number }>(
      '/api/auth/test',
      {
        method: 'POST',
        body: { provider, key } as unknown as BodyInit,
        skipBYOK: true,
      },
    );
  } catch (err: unknown) {
    if (isApiError(err)) {
      const body = err.body as { error?: string } | null;
      return { ok: false, error: body?.error ?? err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Build the SSE URL for the brief endpoint. EventSource can't send headers,
 *  so BYOK on this endpoint will need to fall back to query params on the
 *  server side. We emit the bare URL here; the server-side fallback (?provider=
 *  &key=) is documented but not encoded yet (would leak keys in browser URL
 *  bar) — the recommended path is to set the BYOK header on a preceding
 *  /api/* call so the server can stash a short-lived session token.
 */
export function buildBriefSSEUrl(marketId: string): string {
  const params = new URLSearchParams({ marketId });
  return `/api/brief?${params.toString()}`;
}
