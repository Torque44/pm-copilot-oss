// analytics.ts — L3 server-side usage log.
//
// What we capture (no raw query text — that's L4, not this):
//   - users.json: one record per wallet → { wallet, handle, firstSeen, lastSeen, visitCount }
//   - events.ndjson: append-only line-delimited log → { ts, wallet, handle, type, marketId?, category?, meta? }
//
// Storage location: $CACHE_DIR/.. (the persistent volume; same /var/data
// tree as snapshot.json but in its own namespace so /api/admin/flush
// doesn't blow away analytics). Files are created on first write.
//
// Privacy contract:
//   - We DO NOT store ask/chat text. event_type='ask' records only that an
//     ask happened, for which marketId. Conversation content stays
//     ephemeral.
//   - Visitors are disclosed via the landing footer + docs/PRIVACY.md.
//   - Admin dump endpoint is gated by ADMIN_TOKEN (see middleware/adminAuth).
//
// Concurrency: single-replica Container Apps deploy → no cross-process
// writers. Within the process we use a simple write queue so concurrent
// appends serialize cleanly.

import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env['CACHE_DIR']
  ? dirname(process.env['CACHE_DIR'])    // /var/data/cache → /var/data
  : join(__dirname, '..', '.cache');
const DIR = join(ROOT, 'analytics');
const USERS_PATH = join(DIR, 'users.json');
const EVENTS_PATH = join(DIR, 'events.ndjson');

export type EventType =
  | 'visit'
  | 'brief'
  | 'ask'
  | 'market_view'
  | 'onboarding_complete';

export type AnalyticsEvent = {
  ts: number;
  wallet: string | null;
  handle: string | null;
  type: EventType;
  marketId?: string;
  category?: string;
  /** Small structured metadata. NEVER raw query text. */
  meta?: Record<string, string | number | boolean>;
};

export type UserRecord = {
  wallet: string;
  handle: string | null;
  firstSeen: number;
  lastSeen: number;
  visitCount: number;
};

type UsersMap = Record<string, UserRecord>;

let users: UsersMap | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function ensureDir(): Promise<void> {
  await mkdir(DIR, { recursive: true });
}

async function loadUsers(): Promise<UsersMap> {
  if (users) return users;
  await ensureDir();
  try {
    const raw = await readFile(USERS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as UsersMap;
    users = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    users = {};
  }
  return users;
}

async function flushUsers(): Promise<void> {
  if (!users) return;
  await ensureDir();
  await writeFile(USERS_PATH, JSON.stringify(users), 'utf8');
}

/** Upsert a user record. No-op if wallet is falsy. */
export async function recordIdentity(
  wallet: string | null | undefined,
  handle: string | null | undefined,
): Promise<void> {
  if (!wallet) return;
  const w = wallet.toLowerCase();
  const h = (handle || '').replace(/^@/, '').trim() || null;
  const now = Date.now();
  writeQueue = writeQueue.then(async () => {
    const u = await loadUsers();
    const prev = u[w];
    if (prev) {
      prev.lastSeen = now;
      prev.visitCount += 1;
      if (h) prev.handle = h;
    } else {
      u[w] = {
        wallet: w,
        handle: h,
        firstSeen: now,
        lastSeen: now,
        visitCount: 1,
      };
    }
    await flushUsers();
  });
  return writeQueue;
}

/** Append a single event to the NDJSON log. */
export async function recordEvent(ev: Omit<AnalyticsEvent, 'ts'>): Promise<void> {
  const wallet = ev.wallet ? ev.wallet.toLowerCase() : null;
  const handle = ev.handle ? ev.handle.replace(/^@/, '').trim() || null : null;
  const full: AnalyticsEvent = {
    ts: Date.now(),
    wallet,
    handle,
    type: ev.type,
    ...(ev.marketId ? { marketId: ev.marketId } : {}),
    ...(ev.category ? { category: ev.category } : {}),
    ...(ev.meta ? { meta: ev.meta } : {}),
  };
  writeQueue = writeQueue.then(async () => {
    await ensureDir();
    await appendFile(EVENTS_PATH, JSON.stringify(full) + '\n', 'utf8');
  });
  return writeQueue;
}

/** Read the full events log into memory. Use only inside the admin
 *  endpoint — at hundreds of users this is fast; at millions it'd want
 *  a sqlite migration. */
async function loadAllEvents(): Promise<AnalyticsEvent[]> {
  await ensureDir();
  try {
    const raw = await readFile(EVENTS_PATH, 'utf8');
    const out: AnalyticsEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { out.push(JSON.parse(trimmed) as AnalyticsEvent); } catch { /* skip bad line */ }
    }
    return out;
  } catch {
    return [];
  }
}

/** Aggregate stats for the admin dashboard / portfolio narrative. */
export async function getStats(): Promise<{
  totals: {
    users: number;
    events: number;
    visits: number;
    briefs: number;
    asks: number;
    marketViews: number;
  };
  topMarkets: Array<{ marketId: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
  dailyActiveUsers: Array<{ date: string; uniqueWallets: number }>;
  retention: { returningWithin7d: number; returningWithin30d: number };
  newestUsers: UserRecord[];
}> {
  const u = await loadUsers();
  const events = await loadAllEvents();

  let visits = 0, briefs = 0, asks = 0, marketViews = 0;
  const marketCounts = new Map<string, number>();
  const catCounts = new Map<string, number>();
  const dayWallets = new Map<string, Set<string>>();

  for (const e of events) {
    if (e.type === 'visit') visits++;
    else if (e.type === 'brief') briefs++;
    else if (e.type === 'ask') asks++;
    else if (e.type === 'market_view') marketViews++;
    if (e.marketId) {
      marketCounts.set(e.marketId, (marketCounts.get(e.marketId) ?? 0) + 1);
    }
    if (e.category) {
      catCounts.set(e.category, (catCounts.get(e.category) ?? 0) + 1);
    }
    if (e.wallet) {
      const day = new Date(e.ts).toISOString().slice(0, 10);
      let set = dayWallets.get(day);
      if (!set) { set = new Set(); dayWallets.set(day, set); }
      set.add(e.wallet);
    }
  }

  const topMarkets = [...marketCounts.entries()]
    .sort(([, a], [, b]) => b - a).slice(0, 20)
    .map(([marketId, count]) => ({ marketId, count }));
  const topCategories = [...catCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([category, count]) => ({ category, count }));
  const dailyActiveUsers = [...dayWallets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, set]) => ({ date, uniqueWallets: set.size }));

  const now = Date.now();
  const day7 = now - 7 * 24 * 60 * 60 * 1000;
  const day30 = now - 30 * 24 * 60 * 60 * 1000;
  let returningWithin7d = 0, returningWithin30d = 0;
  for (const r of Object.values(u)) {
    if (r.visitCount > 1) {
      if (r.lastSeen >= day7) returningWithin7d++;
      if (r.lastSeen >= day30) returningWithin30d++;
    }
  }

  const newestUsers = [...Object.values(u)]
    .sort((a, b) => b.firstSeen - a.firstSeen)
    .slice(0, 50);

  return {
    totals: {
      users: Object.keys(u).length,
      events: events.length,
      visits,
      briefs,
      asks,
      marketViews,
    },
    topMarkets,
    topCategories,
    dailyActiveUsers,
    retention: { returningWithin7d, returningWithin30d },
    newestUsers,
  };
}

/** Full dump — used by the admin endpoint when ?format=raw is passed. */
export async function dumpAll(): Promise<{ users: UserRecord[]; events: AnalyticsEvent[] }> {
  const u = await loadUsers();
  const events = await loadAllEvents();
  return { users: Object.values(u), events };
}
