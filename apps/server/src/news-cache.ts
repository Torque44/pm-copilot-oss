// news-cache.ts — process-singleton NewsCache instance. The brief route
// pulls this once per process and passes it through to runSupervisor →
// runNewsAgent so all briefs share the same 6h LRU.

import { NewsCache } from '@pm-copilot/core/news/cache';

let instance: NewsCache | null = null;

export function getNewsCache(): NewsCache {
  if (!instance) instance = new NewsCache();
  return instance;
}
