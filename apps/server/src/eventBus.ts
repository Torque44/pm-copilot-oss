// eventBus.ts — tiny pub/sub so multiple SSE connections can subscribe to
// the same market's live updates without re-running agents.
//
// Each topic keeps a rolling buffer so a late subscriber gets the last N
// events immediately (an "initial hydrate"), then live updates.

type Listener<T> = (event: T) => void;

type Channel<T = unknown> = {
  listeners: Set<Listener<T>>;
  buffer: T[];
  bufferMax: number;
};

const channels = new Map<string, Channel>();

function getChan<T>(topic: string, bufferMax = 200): Channel<T> {
  let c = channels.get(topic) as Channel<T> | undefined;
  if (!c) {
    c = { listeners: new Set<Listener<T>>(), buffer: [], bufferMax };
    channels.set(topic, c as unknown as Channel);
  }
  return c;
}

export function publish<T>(topic: string, event: T): void {
  const c = getChan<T>(topic);
  c.buffer.push(event);
  if (c.buffer.length > c.bufferMax) {
    c.buffer.splice(0, c.buffer.length - c.bufferMax);
  }
  for (const l of Array.from(c.listeners)) {
    try { l(event); } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[bus]', msg);
    }
  }
}

export function subscribe<T>(topic: string, fn: Listener<T>): () => void {
  const c = getChan<T>(topic);
  c.listeners.add(fn);
  return () => { c.listeners.delete(fn); };
}

export function replay<T>(topic: string): T[] {
  const c = channels.get(topic) as Channel<T> | undefined;
  return c ? [...c.buffer] : [];
}

export function clearTopic(topic: string): void {
  channels.delete(topic);
}

export function topicsForPrefix(prefix: string): string[] {
  return [...channels.keys()].filter(k => k.startsWith(prefix));
}
