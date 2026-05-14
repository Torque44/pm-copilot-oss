// client.ts — thin fetch wrapper that auto-attaches BYOK headers.
//
// All BYOK keys live in cryptoStorage (IndexedDB AES-GCM). Each call reads
// presence + plaintext on demand; once decrypted the master key is cached in
// memory by cryptoStorage so repeat reads are cheap. Set `skipBYOK: true`
// to opt out (e.g., the auth-test endpoint where we pass keys in the body).
//
// All endpoints (including the NDJSON-streamed /api/brief) are reached via
// fetch with headers — EventSource was retired in the cf-azure-rewrite, so
// the server-side query-param key fallback has been removed as well.

import type { ProviderName } from '../types';
import { getSecret } from './cryptoStorage';

// Per-provider key slots (schema v2 — see useProvider.ts). The header builder
// reads all of them, applies the orchestrator rank to pick the primary, and
// always surfaces xAI separately so the server-side routing can fan it into
// both routing.primary and routing.sentiment when xAI is the chosen primary.
const KEY_ANTHROPIC = 'byok:key:anthropic';
const KEY_GOOGLE = 'byok:key:google';
const KEY_OPENAI = 'byok:key:openai';
const KEY_XAI = 'byok:key:xai';
const KEY_PERPLEXITY = 'byok:perplexity';
const CC_ENABLED = 'byok:cc-enabled';
const PRIMARY_OVERRIDE = 'byok:primary:override';

/** Orchestrator rank — when no explicit override, the highest-tier connected
 *  provider on this list becomes primary. Mirrors the rank in useProvider.ts. */
const ORCHESTRATOR_RANK: readonly ProviderName[] = [
  'anthropic-cc', 'anthropic', 'google', 'openai', 'xai',
];

function providerKeySlot(p: ProviderName): string | null {
  switch (p) {
    case 'anthropic': return KEY_ANTHROPIC;
    case 'google':    return KEY_GOOGLE;
    case 'openai':    return KEY_OPENAI;
    case 'xai':       return KEY_XAI;
    case 'anthropic-cc':
    case 'perplexity':
    default:          return null;
  }
}

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
    const [
      anthropic, google, openai, xai, perplexity, ccEnabled, override,
    ] = await Promise.all([
      getSecret(KEY_ANTHROPIC),
      getSecret(KEY_GOOGLE),
      getSecret(KEY_OPENAI),
      getSecret(KEY_XAI),
      getSecret(KEY_PERPLEXITY),
      getSecret(CC_ENABLED),
      getSecret(PRIMARY_OVERRIDE),
    ]);
    const isProvider = (s: unknown): s is ProviderName =>
      s === 'anthropic' || s === 'anthropic-cc' || s === 'openai' ||
      s === 'google' || s === 'xai' || s === 'perplexity';
    const connected = (p: ProviderName): string | null => {
      switch (p) {
        case 'anthropic-cc': return ccEnabled === '1' ? '' : null;
        case 'anthropic':    return anthropic ?? null;
        case 'google':       return google ?? null;
        case 'openai':       return openai ?? null;
        case 'xai':          return xai ?? null;
        case 'perplexity':   return perplexity ?? null;
        default: return null;
      }
    };
    // Pick primary: explicit override (if connected) beats auto-rank.
    let chosen: ProviderName | null = null;
    if (isProvider(override) && connected(override) !== null) {
      chosen = override;
    } else {
      for (const p of ORCHESTRATOR_RANK) {
        if (connected(p) !== null) { chosen = p; break; }
      }
    }
    if (chosen) {
      headers['x-llm-provider'] = chosen;
      // Subprocess primary has no key — the server detects the
      // 'anthropic-cc' marker and routes via the local Claude Code CLI.
      const slot = providerKeySlot(chosen);
      const k = slot ? connected(chosen) : null;
      if (k) headers['x-llm-key'] = k;
    }
    // Sub-role keys travel independently. xAI is sent even when it's also
    // the primary so the server's routing.sentiment slot lights up.
    if (perplexity) headers['x-perplexity-key'] = perplexity;
    if (xai) headers['x-xai-key'] = xai;
  } catch {
    // BYOK is best-effort — if cryptoStorage fails we just send no headers.
  }
  return headers;
}

/** Attach the visitor's pasted wallet + X handle to every request so the
 *  server can attribute usage events (see docs/PRIVACY.md). Reads
 *  unencrypted localStorage — these are NOT secrets the way BYOK keys are.
 *  Missing values just mean we send anonymous events. */
function loadIdentityHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const headers: Record<string, string> = {};
  try {
    const wallet = window.localStorage.getItem('pm-copilot:auth:wallet');
    const handle = window.localStorage.getItem('pm-copilot:auth:xHandle');
    if (wallet) headers['x-pm-wallet'] = wallet;
    if (handle) headers['x-pm-handle'] = handle;
  } catch {
    // Best-effort — localStorage can throw in private windows / Safari.
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

/** Resolve a relative `/api/...` path against VITE_API_BASE if set.
 *  In dev the Vite proxy handles relative paths to the local backend on
 *  :8787. In production (Cloudflare Pages → Azure Container App) the
 *  frontend and backend live on different origins, so we prepend the
 *  configured backend host. Absolute URLs pass through untouched. */
function resolvePath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (import.meta.env.VITE_API_BASE ?? '').toString().replace(/\/$/, '');
  if (!base) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

export async function apiFetch(path: string, opts: ApiRequestOpts = {}): Promise<Response> {
  const { skipBYOK, headers: rawHeaders, body: rawBody, ...rest } = opts;
  const byokHeaders = skipBYOK ? {} : await loadByokHeaders();
  const identityHeaders = loadIdentityHeaders();
  const headers = mergeHeaders(rawHeaders, { ...byokHeaders, ...identityHeaders });

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

  const res = await fetch(resolvePath(path), init);
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

// `buildBriefSSEUrl` was removed in the cf-azure-rewrite. The /api/brief
// endpoint is now a synchronous JSON GET, so callers use `apiJSON` /
// `apiFetch` like any other endpoint — BYOK keys travel as headers via
// the existing apiFetch wrapper, no query-string fallback needed.
