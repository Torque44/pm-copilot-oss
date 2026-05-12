// POST /api/auth/test
// Body: { provider, key }
// Tests a provider key with a single round-trip; returns { ok, model, error }.
// Used by SetupScreen to validate user-supplied keys before saving to IndexedDB.

import type { Request, Response } from 'express';
import { byokProvider } from '@pm-copilot/core';
import { sanitizeProviderError } from '../lib/sanitizeError.js';

export async function authTestHandler(req: Request, res: Response) {
  const { provider, key } = (req.body || {}) as { provider?: string; key?: string };

  if (!provider || !key) {
    res.status(400).json({ ok: false, error: 'missing provider or key' });
    return;
  }

  try {
    const routing = byokProvider({ primary: provider, primaryKey: key });
    const result = await routing.primary.complete('Reply with the single word: ok', {
      tier: 'fast',
      timeoutMs: 10_000,
      systemPrompt: 'You are a key-validator. Reply with exactly: ok',
    });

    if (!result.ok) {
      // Sanitize: drop model URLs, stack traces, and any key fragments an
      // upstream gateway might have echoed into the error body.
      res.json({
        ok: false,
        error: sanitizeProviderError(result.error),
        model: result.model,
      });
      return;
    }

    res.json({
      ok: true,
      model: result.model,
      sample: (result.text || '').slice(0, 50),
      ms: result.elapsedMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: sanitizeProviderError(msg) });
  }
}
