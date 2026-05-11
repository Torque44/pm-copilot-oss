// BYOK middleware — reads provider keys from headers and attaches to
// `req.byok`. Server NEVER persists, NEVER logs.
//
// Headers (all clients use fetch with these — query-param fallback was
// removed when the SSE → NDJSON migration deleted EventSource usage):
//   x-llm-provider          → 'anthropic' | 'openai' | 'google' | 'perplexity'
//   x-llm-key               → primary provider key
//   x-perplexity-key        → optional News enhancement key
//   x-xai-key               → optional Sentiment agent key

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

  const rawPrimary = h('x-llm-provider');
  const validatedPrimary = rawPrimary && VALID_PROVIDERS.has(rawPrimary) ? rawPrimary : undefined;

  req.byok = {
    primary: validatedPrimary,
    primaryKey: h('x-llm-key'),
    perplexityKey: h('x-perplexity-key'),
    xaiKey: h('x-xai-key'),
  };

  next();
}
