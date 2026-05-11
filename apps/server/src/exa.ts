// Server-side Exa singleton.
//
// Lazily constructs a Searcher from the EXA_API_KEY env var on first
// request. Returns null when the env var isn't set so callers (news
// agent, ask augmentation) can detect "Exa unavailable" and fall back
// to provider-only paths. Per-request creation would work too but
// would cost a constructor + module import per /api/brief; the
// singleton is cheaper and the Exa SDK is stateless.
//
// To enable: set EXA_API_KEY in Azure Container Apps secrets. The
// public demo can run on Exa's free tier (~1000 searches/month) plus
// the brief-store cache, which covers a few hundred unique markets a
// month easily.

import { makeExaSearcher, type Searcher } from '@pm-copilot/core';

let cached: Searcher | null | undefined;

export function getExaSearcher(): Searcher | null {
  if (cached !== undefined) return cached;
  cached = makeExaSearcher(process.env['EXA_API_KEY'] ?? null);
  if (cached) {
    console.info('[pm-copilot] Exa searcher initialised (web search backed by Exa AI)');
  }
  return cached;
}
