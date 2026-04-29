// useWatchlist — local watchlist persisted to localStorage with a window
// CustomEvent fan-out so multiple hook instances stay synchronized in the
// same tab. The 'storage' event covers cross-tab sync.

import { useCallback, useEffect, useState } from 'react';
import type { WatchItem } from '../types';

const STORAGE_KEY = 'pm-copilot:watchlist:v1';
const CHANGE_EVENT = 'watchlist:change';

type WatchlistChangeDetail = { list: WatchItem[] };

function readStorage(): WatchItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is WatchItem => {
      if (!x || typeof x !== 'object') return false;
      const o = x as Record<string, unknown>;
      return typeof o['marketId'] === 'string' && typeof o['title'] === 'string';
    });
  } catch {
    return [];
  }
}

function writeStorage(list: WatchItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // quota exceeded / disabled — silently swallow
  }
}

function broadcast(list: WatchItem[]): void {
  if (typeof window === 'undefined') return;
  const ev = new CustomEvent<WatchlistChangeDetail>(CHANGE_EVENT, { detail: { list } });
  window.dispatchEvent(ev);
}

export type UseWatchlistResult = {
  list: WatchItem[];
  add: (item: WatchItem) => void;
  remove: (marketId: string) => void;
  has: (marketId: string) => boolean;
  clear: () => void;
};

export function useWatchlist(): UseWatchlistResult {
  const [list, setList] = useState<WatchItem[]>(() => readStorage());

  // Subscribe to in-tab CustomEvents and cross-tab 'storage' events.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onChange = (ev: Event) => {
      const ce = ev as CustomEvent<WatchlistChangeDetail>;
      if (ce.detail && Array.isArray(ce.detail.list)) {
        setList(ce.detail.list);
      } else {
        setList(readStorage());
      }
    };

    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== STORAGE_KEY) return;
      setList(readStorage());
    };

    window.addEventListener(CHANGE_EVENT, onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const commit = useCallback((next: WatchItem[]) => {
    writeStorage(next);
    setList(next);
    broadcast(next);
  }, []);

  const add = useCallback(
    (item: WatchItem) => {
      const current = readStorage();
      if (current.some((w) => w.marketId === item.marketId)) return;
      commit([...current, item]);
    },
    [commit],
  );

  const remove = useCallback(
    (marketId: string) => {
      const current = readStorage();
      const next = current.filter((w) => w.marketId !== marketId);
      if (next.length === current.length) return;
      commit(next);
    },
    [commit],
  );

  const has = useCallback(
    (marketId: string) => list.some((w) => w.marketId === marketId),
    [list],
  );

  const clear = useCallback(() => commit([]), [commit]);

  return { list, add, remove, has, clear };
}
