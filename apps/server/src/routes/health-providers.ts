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

import type { Request, Response } from 'express';
import { byokProvider } from '@pm-copilot/core/providers/byok';
import { makeAnthropicProvider } from '@pm-copilot/core';

type ProviderProbe = {
  ok: boolean;
  ms: number;
  model?: string;
  error?: string;
};

async function probe(provider: ReturnType<typeof byokProvider>['primary']): Promise<ProviderProbe> {
  const t0 = Date.now();
  try {
    const r = await provider.complete('Reply with the single word: ok', {
      tier: 'fast',
      systemPrompt: 'You are a connection-check bot. Reply with exactly: ok',
      timeoutMs: 8_000,
    });
    if (!r.ok) {
      return { ok: false, ms: r.elapsedMs, error: r.error || 'unknown' };
    }
    return { ok: true, ms: r.elapsedMs, model: r.model };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function healthProvidersHandler(req: Request, res: Response) {
  // Always probe the user's currently-configured primary (BYOK or env-var).
  const routing = byokProvider(req.byok ?? {});
  const primaryName = req.byok?.primary || process.env['PROVIDER'] || 'anthropic';

  const checks: Record<string, ProviderProbe> = {};
  checks[primaryName] = await probe(routing.primary);

  // Always also probe Claude Code subprocess specifically — even if primary
  // is something else, the user may want to know if subprocess auth is live
  // for fallback. Skip if primary already IS subprocess (avoid double-probe).
  const isPrimarySubprocess =
    (primaryName === 'anthropic' || primaryName === 'anthropic-cc') &&
    !req.byok?.primaryKey &&
    !process.env['ANTHROPIC_API_KEY'];
  if (!isPrimarySubprocess) {
    const subprocess = makeAnthropicProvider(null); // forces subprocess path
    checks['claude-code'] = await probe(subprocess);
  } else {
    // Primary IS subprocess — alias the result so the UI can read it under
    // a stable key without double-probing.
    checks['claude-code'] = checks[primaryName]!;
  }

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
