// Tiny insertion-ordered LRU built on top of Map. Caps memory growth on
// in-process route caches that key off user-supplied strings (handles,
// wallets, etc) — without a cap, a flood of unique inputs grows the Map
// indefinitely until the container OOMs.
//
// Map iteration order is insertion order; we evict the OLDEST entry when
// we cross maxSize. Touching an entry (via get + re-set) is the caller's
// responsibility if they want true recency semantics; for our route
// caches, FIFO eviction is fine because all entries are TTL-gated anyway.

export class BoundedCache<V> {
  private store = new Map<string, V>();

  constructor(private readonly maxSize: number) {
    if (maxSize <= 0) throw new Error('BoundedCache: maxSize must be > 0');
  }

  get(key: string): V | undefined {
    return this.store.get(key);
  }

  set(key: string, value: V): void {
    if (this.store.has(key)) {
      this.store.set(key, value);
      return;
    }
    if (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, value);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }
}
