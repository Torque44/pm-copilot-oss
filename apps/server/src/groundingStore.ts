// Tiny in-memory store of the raw grounding data the supervisor pulls per
// market. Lets /api/ask answer questions without re-fetching the book/holders/news.
// Backs to disk so re-selecting a market after a tsx watch restart feels instant.

import type { BookGrounding, HoldersGrounding, NewsGrounding } from '@pm-copilot/core';
import { markDirty, registerProducer } from './persist.js';
import { publish } from './eventBus.js';

type Slot = {
  book?: BookGrounding | null;
  holders?: HoldersGrounding | null;
  news?: NewsGrounding | null;
  updatedAt: number;
};

type GroundingKind = 'book' | 'holders' | 'news';

type GroundingUpdate =
  | { kind: 'book'; data: BookGrounding | null; updatedAt: number }
  | { kind: 'holders'; data: HoldersGrounding | null; updatedAt: number }
  | { kind: 'news'; data: NewsGrounding | null; updatedAt: number };

const TTL_MS = 10 * 60 * 1000;
const store = new Map<string, Slot>();

let rehydrated = false;
export function hydrate(serialized: Record<string, Slot> | undefined) {
  if (rehydrated || !serialized) { rehydrated = true; return; }
  const now = Date.now();
  for (const [k, v] of Object.entries(serialized)) {
    if (v && typeof v === 'object' && now - v.updatedAt <= TTL_MS) {
      store.set(k, v);
    }
  }
  rehydrated = true;
}

registerProducer(() => {
  const out: Record<string, Slot> = {};
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (now - v.updatedAt <= TTL_MS) out[k] = v;
  }
  return { grounding: out };
});

export function rememberGrounding(
  marketId: string,
  kind: 'book',
  data: BookGrounding | null,
): void;
export function rememberGrounding(
  marketId: string,
  kind: 'holders',
  data: HoldersGrounding | null,
): void;
export function rememberGrounding(
  marketId: string,
  kind: 'news',
  data: NewsGrounding | null,
): void;
export function rememberGrounding(
  marketId: string,
  kind: GroundingKind,
  data: BookGrounding | HoldersGrounding | NewsGrounding | null
): void {
  const slot: Slot = store.get(marketId) ?? { updatedAt: 0 };
  if (kind === 'book') slot.book = data as BookGrounding | null;
  else if (kind === 'holders') slot.holders = data as HoldersGrounding | null;
  else slot.news = data as NewsGrounding | null;
  slot.updatedAt = Date.now();
  store.set(marketId, slot);
  markDirty();
  // Announce to any live subscriber.
  const update: GroundingUpdate = { kind, data, updatedAt: slot.updatedAt } as GroundingUpdate;
  publish<GroundingUpdate>(`grounding:${marketId}`, update);
}

export function readGrounding(marketId: string): Slot | null {
  const slot = store.get(marketId);
  if (!slot) return null;
  if (Date.now() - slot.updatedAt > TTL_MS) {
    store.delete(marketId);
    markDirty();
    return null;
  }
  return slot;
}

export function allFreshMarketIds(): string[] {
  const now = Date.now();
  return [...store.entries()]
    .filter(([, v]) => now - v.updatedAt <= TTL_MS)
    .map(([k]) => k);
}
