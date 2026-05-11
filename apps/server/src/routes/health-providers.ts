// GET /api/health/providers
//
// Probes each configured primary provider with a tiny prompt and reports
// whether it actually answers. Used by the right rail to show a green/red
// "claude code: connected" indicator so users don't have to guess whether
// `claude /login` worked.
//
// Body of response:
//   {
//     subprocess: { ok: boolean, ms: number, model?: string, error?: string },
//     env: { anthropic: bool, openai: bool, google: bool, perplexity: bool, xai: bool }
//   }
//
// Honours BYOK headers/query for primary if present (so paste-key users get
// a check against THEIR key, not just the env-var fallback).
//
// Why the timeouts are generous:
//   The Claude Code subprocess cold-starts on every fresh probe (we mint a
//   new instance via makeAnthropicProvider(null) so the probe doesn't share
//   warm state with the brief/ask provider). Cold start regularly takes
//   15-25s on Windows. An 8s probe timeout was wrongly reporting
//   "not reachable" for a healthy install — see screenshot in chat history.
//   We use 30s here AND cache success for 90s so the right rail doesn't
//   thrash + cold-start the subprocess on every focus change.

import type { Request, Response } from 'express';
import { byokProvider } from '@pm-copilot/core/providers/byok';
import { makeAnthropicProvider } from '@pm-copilot/core';

type ProviderProbe = {
  ok: boolean;
  ms: number;
  error?: string;
};

/** Drop model names, API URLs, and internal stack traces from probe errors;
 *  return a short categorical hint so the right rail can show "auth failed"
 *  vs "timed out" without leaking provider implementation detail. */
function sanitizeProviderError(raw: string | undefined): string {
  if (!raw) return 'unknown';
  if (/401|403|unauthor|invalid.*key/i.test(raw)) return 'auth failed — check key';
  if (/timeout|aborted/i.test(raw)) return 'timed out';
  if (/429|rate.*limit|quota/i.test(raw)) return 'rate limited';
  if (/credit balance|insufficient/i.test(raw)) return 'out of credit';
  if (/Not logged in|claude-code|Please run/i.test(raw)) return 'claude code not signed in';
  return 'provider error';
}

const PROBE_TIMEOUT_MS = 30_000;          // tolerate subprocess cold start
const SUCCESS_CACHE_TTL_MS = 90_000;      // skip re-probe after a recent green

type CacheEntry = { at: number; result: ProviderProbe };
const probeCache = new Map<string, CacheEntry>();

function cacheKey(name: string, byokKey: string | undefined): string {
  // Paste-key users have a different "real" provider than env-var users —
  // bucket them separately so a green probe for one key isn't reused
  // for another.
  return `${name}::${byokKey ? byokKey.slice(0, 12) : 'env'}`;
}

async function probe(
  key: string,
  provider: ReturnType<typeof byokProvider>['primary'],
): Promise<ProviderProbe> {
  const cached = probeCache.get(key);
  if (cached && cached.result.ok && Date.now() - cached.at < SUCCESS_CACHE_TTL_MS) {
    return cached.result;
  }
  const t0 = Date.now();
  try {
    const r = await provider.complete('Reply with the single word: ok', {
      tier: 'fast',
      systemPrompt: 'You are a connection-check bot. Reply with exactly: ok',
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const result: ProviderProbe = r.ok
      ? { ok: true, ms: r.elapsedMs }
      : { ok: false, ms: r.elapsedMs, error: sanitizeProviderError(r.error) };
    probeCache.set(key, { at: Date.now(), result });
    return result;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const result: ProviderProbe = {
      ok: false,
      ms: Date.now() - t0,
      error: sanitizeProviderError(raw),
    };
    probeCache.set(key, { at: Date.now(), result });
    return result;
  }
}

export async function healthProvidersHandler(req: Request, res: Response) {
  // Always probe the user's currently-configured primary (BYOK or env-var).
  const routing = byokProvider(req.byok ?? {});
  const primaryName = req.byok?.primary || process.env['PROVIDER'] || 'anthropic';

  const checks: Record<string, ProviderProbe> = {};
  checks[primaryName] = await probe(
    cacheKey(primaryName, req.byok?.primaryKey),
    routing.primary,
  );

  // Probe Claude Code subprocess ONLY when the user's setup is actually
  // anthropic-related. Showing a permanent "claude code: not reachable" red
  // dot to a user who picked OpenAI as primary is just noise — they never
  // installed the CLI, never logged in, and don't care. Three branches:
  //
  //   1. Primary IS the subprocess (anthropic-cc OR anthropic with no key):
  //      alias the existing primary probe to 'claude-code' so the UI reads
  //      under a stable key without re-probing.
  //   2. Primary is anthropic via API key: explicitly probe subprocess so
  //      the user sees whether their fallback path is live.
  //   3. Primary is anything else (openai, xai, gemini, perplexity): skip
  //      claude-code entirely. Don't probe, don't include in checks.
  const isPrimarySubprocess =
    (primaryName === 'anthropic' || primaryName === 'anthropic-cc') &&
    !req.byok?.primaryKey &&
    !process.env['ANTHROPIC_API_KEY'];
  const isPrimaryAnthropicApiKey =
    (primaryName === 'anthropic' || primaryName === 'anthropic-cc') &&
    !isPrimarySubprocess;
  if (isPrimarySubprocess) {
    checks['claude-code'] = checks[primaryName]!;
  } else if (isPrimaryAnthropicApiKey) {
    const subprocess = makeAnthropicProvider(null);
    checks['claude-code'] = await probe(cacheKey('claude-code', undefined), subprocess);
  }
  // Else: primary is openai/xai/gemini/perplexity — claude-code is not
  // surfaced. The right rail will only show the user's actual primary.

  res.json({
    primary: primaryName,
    checks,
    env: {
      anthropic: !!process.env['ANTHROPIC_API_KEY'],
      openai: !!process.env['OPENAI_API_KEY'],
      google: !!(process.env['GOOGLE_API_KEY'] || process.env['GEMINI_API_KEY']),
      perplexity: !!process.env['PERPLEXITY_API_KEY'],
      xai: !!process.env['XAI_API_KEY'],
    },
  });
}
