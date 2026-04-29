// useRecentlyViewed — last N markets the user opened, persisted in
// localStorage so the empty-state grid shows real history (not the hardcoded
// design-bundle demo cards).

import { useCallback, useEffect, useState } from 'react';
import type { Market } from '../types';

const STORAGE_KEY = 'pm-copilot:recents:v1';
const MAX_RECENTS = 6;

export type RecentEntry = {
  marketId: string;
  title: string;
  yes: number | null;
  resolveIn: string;
  category: string;
  visitedAt: number;
};

function readStorage(): RecentEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentEntry =>
        !!e && typeof e === 'object' && typeof (e as RecentEntry).marketId === 'string',
    );
  } catch {
    return [];
  }
}

function writeStorage(entries: RecentEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota exceeded — ignore, oldest entries will fall off naturally */
  }
}

export type UseRecentlyViewedResult = {
  list: RecentEntry[];
  push: (m: Market & { category?: string }) => void;
  clear: () => void;
};

export function useRecentlyViewed(): UseRecentlyViewedResult {
  const [list, setList] = useState<RecentEntry[]>(() => readStorage());

  // Cross-tab sync via the native `storage` event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setList(readStorage());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const push = useCallback((m: Market & { category?: string }) => {
    setList((prev) => {
      const filtered = prev.filter((e) => e.marketId !== m.id);
      const entry: RecentEntry = {
        marketId: m.id,
        title: m.title,
        yes: m.yes ?? null,
        resolveIn: m.resolveIn,
        category: m.category || 'other',
        visitedAt: Date.now(),
      };
      const next = [entry, ...filtered].slice(0, MAX_RECENTS);
      writeStorage(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setList([]);
    writeStorage([]);
  }, []);

  return { list, push, clear };
}
