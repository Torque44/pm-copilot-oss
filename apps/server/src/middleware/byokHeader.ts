// BYOK middleware — reads provider keys from headers (preferred) or query
// params (fallback for SSE endpoints where EventSource can't send headers).
// Attaches to `req.byok`. Server NEVER persists, NEVER logs.
//
// Headers (preferred — used by fetch/apiJSON):
//   x-llm-provider          → 'anthropic' | 'openai' | 'google' | 'perplexity'
//   x-llm-key               → primary provider key
//   x-perplexity-key        → optional News enhancement key
//   x-xai-key               → optional Sentiment agent key
//
// Query params (fallback — used by EventSource on /api/brief):
//   ?provider=  ?key=  ?pkey=  ?xkey=
//
// Trade-off: query-param keys appear in the URL bar + access logs. Acceptable
// for local private beta where the only consumer of the URL is the user's own
// browser. For production we'd switch to a session-token handshake, see HANDOFF.md.

import type { Request, Response, NextFunction } from 'express';
import type { BYOKHeaders } from '@pm-copilot/core';

// Augment Express's Request with `byok` so route handlers can read
// `req.byok` with full type safety. We extend the `express` module surface
// (rather than `express-serve-static-core`) so the augmentation matches the
// types we actually import from.
declare module 'express' {
  interface Request {
    byok?: BYOKHeaders;
  }
}

const VALID_PROVIDERS = new Set(['anthropic', 'anthropic-cc', 'openai', 'google', 'gemini', 'perplexity', 'xai', 'grok']);

export function byokHeader(req: Request, _res: Response, next: NextFunction) {
  const h = (name: string) => {
    const v = req.headers[name.toLowerCase()];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const q = (name: string) => {
    const v = req.query[name];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

  const rawPrimary = h('x-llm-provider') ?? q('provider');
  const validatedPrimary = rawPrimary && VALID_PROVIDERS.has(rawPrimary) ? rawPrimary : undefined;

  req.byok = {
    primary: validatedPrimary,
    primaryKey: h('x-llm-key') ?? q('key'),
    perplexityKey: h('x-perplexity-key') ?? q('pkey'),
    xaiKey: h('x-xai-key') ?? q('xkey'),
  };

  next();
}
