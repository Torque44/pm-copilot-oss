// Tiny in-memory TTL cache with singleflight semantics.
// Prevents Polymarket API hammering when multiple briefs are requested in parallel.
// Backs up to disk via persist.ts so the cache survives tsx watch restarts.

import { markDirty, registerProducer } from './persist.js';

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

let rehydrated = false;
export function hydrate(serialized: Record<string, { value: unknown; expiresAt: number }> | undefined) {
  if (rehydrated || !serialized) { rehydrated = true; return; }
  const now = Date.now();
  for (const [k, v] of Object.entries(serialized)) {
    if (v && typeof v === 'object' && 'expiresAt' in v && v.expiresAt > now) {
      store.set(k, v as Entry<unknown>);
    }
  }
  rehydrated = true;
}

// Expose the slice to persist.ts
registerProducer(() => {
  const out: Record<string, Entry<unknown>> = {};
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.expiresAt > now) out[k] = v;
  }
  return { cache: out };
});

// Cap singleflight at 30s. If a loader hangs past this, the in-flight slot
// frees up and the next caller fires a fresh loader — better to retry than
// pile up indefinite waiters.
const INFLIGHT_TIMEOUT_MS = 30_000;

export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const inflightHit = inflight.get(key) as Promise<T> | undefined;
  if (inflightHit) return inflightHit;

  const p = (async () => {
    try {
      const value = await Promise.race([
        loader(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`cache loader timeout after ${INFLIGHT_TIMEOUT_MS}ms`)), INFLIGHT_TIMEOUT_MS),
        ),
      ]);
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      markDirty();
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

export function invalidate(key: string) {
  store.delete(key);
  inflight.delete(key);
  markDirty();
}

export function clear() {
  store.clear();
  inflight.clear();
  markDirty();
}
