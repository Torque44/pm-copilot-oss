// persist.ts — write-through disk snapshot of the in-memory caches so they
// survive `tsx watch` restarts and cold reloads. The server rehydrates on boot.
//
// Writes are debounced (1s) so hot paths stay cheap. Snapshot lives at
// .cache/snapshot.json (gitignored).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CACHE_DIR = join(__dirname, '..', '.cache');
const SNAPSHOT_PATH = join(CACHE_DIR, 'snapshot.json');

type Snapshot = {
  version: 1;
  savedAt: number;
  cache: Record<string, { value: unknown; expiresAt: number }>;
  grounding: Record<string, { book?: unknown; holders?: unknown; news?: unknown; updatedAt: number }>;
  briefs: Record<string, { events: unknown[]; savedAt: number }>;
};

let loaded: Snapshot | null = null;
let dirty = false;
let flushTimer: NodeJS.Timeout | null = null;

// Registered producers: each returns the current snapshot for their slice.
type Producer = () => Partial<Snapshot>;
const producers: Producer[] = [];

export function registerProducer(fn: Producer) {
  producers.push(fn);
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  if (loaded) return loaded;
  try {
    const raw = await readFile(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Snapshot;
    if (parsed?.version !== 1) return null;
    loaded = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function markDirty() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (dirty) void flush();
  }, 1000);
}

export async function flush(): Promise<void> {
  if (!dirty && !loaded) return;
  dirty = false;
  const snap: Snapshot = {
    version: 1,
    savedAt: Date.now(),
    cache: {},
    grounding: {},
    briefs: {},
  };
  for (const p of producers) {
    const part = p();
    if (part.cache) Object.assign(snap.cache, part.cache);
    if (part.grounding) Object.assign(snap.grounding, part.grounding);
    if (part.briefs) Object.assign(snap.briefs, part.briefs);
  }
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(SNAPSHOT_PATH, JSON.stringify(snap), 'utf8');
  } catch (err) {
    console.warn('[persist] write failed:', (err as Error).message);
  }
}

// Flush on graceful shutdown so we don't lose the last second of state.
let installed = false;
export function installShutdownHooks() {
  if (installed) return;
  installed = true;
  const bye = () => { void flush().finally(() => process.exit(0)); };
  process.once('SIGINT', bye);
  process.once('SIGTERM', bye);
  process.once('beforeExit', () => { if (dirty) void flush(); });
}
