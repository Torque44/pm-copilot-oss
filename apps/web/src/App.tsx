// pm-copilot-oss · App.tsx
//
// Top-level orchestration:
//   - Setup gate (force /setup until a primary provider key is configured).
//   - Pull events list from /api/events for the LeftRail.
//   - Stream brief via useBrief once a market is selected.
//   - Wire watchlist + positions on the RightRail.
//   - Keyboard shortcuts: ⌘K palette, ⌘1-4 panel focus, ⌘[ ⌘] rail collapse,
//     ⌘B add-to-watchlist, Esc closes overlays.
//   - Citation pill clicks → flashCitation(id).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LeftRail } from './components/LeftRail/LeftRail';
import { MarketHeader } from './components/MarketHeader/MarketHeader';
import { EvidenceGrid } from './components/EvidenceGrid/EvidenceGrid';
import { ResizeHandle } from './components/EvidenceGrid/ResizeHandle';
import type { PanelKey } from './components/EvidenceGrid/Panel';
import { VerdictBand } from './components/VerdictBand/VerdictBand';
import { Chat } from './components/Chat/Chat';
import { RightRail } from './components/RightRail/RightRail';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { EmptyState } from './components/States/EmptyState';
import { LoadingToast } from './components/States/LoadingToast';
import { ErrorState } from './components/States/ErrorState';
import { SetupScreen } from './components/SetupFlow/SetupScreen';
import { PositionStrip } from './components/PositionStrip/PositionStrip';
import { KeyboardHelp } from './components/KeyboardHelp/KeyboardHelp';

import { useEventsList } from './hooks/useEventsList';
import { useBrief } from './hooks/useBrief';
import { useProvider } from './hooks/useProvider';
import { useProviderHealth } from './hooks/useProviderHealth';
import { useWatchlist } from './hooks/useWatchlist';
import { usePositions } from './hooks/usePositions';
import { useRecentlyViewed } from './hooks/useRecentlyViewed';
import { useFetchedEvent } from './hooks/useFetchedEvent';
import { useAsk } from './hooks/useAsk';
import { useAuth } from './hooks/useAuth';
import { LandingFlow } from './components/LandingFlow/LandingFlow';
import { useRoute } from './lib/routing';
import { flashCitation } from './lib/citationFlash';
import { deriveVerdictStats } from './lib/derivedStats';

import type {
  AgentStatus,
  Citation,
  ComparableHit,
  EventOutcome,
  EventSummary,
  KOLSentimentItem,
  Market,
  NewsItem,
  ProviderName,
  Thesis,
  ThesisNode,
  WatchItem,
} from './types';

// ---------- server response normalisers ----------
// /api/events returns event-centric rows with outcomes shaped { marketId, label, yes, ... }.
// LeftRail's EventSummary expects { id, title, category, outcomes: [{id, name, price}] }.

type RawEventOutcome = {
  marketId?: string;
  label?: string;
  yes?: number;
  no?: number;
  volume24hr?: number;
};

type RawEvent = {
  eventId?: string;
  title?: string;
  category?: string;
  tagSlugs?: string[];
  isMultiOutcome?: boolean;
  outcomes?: RawEventOutcome[];
  totalVolume24hr?: number;
  endDate?: string | null;
};

function normaliseEvents(raw: unknown): EventSummary[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as { events?: RawEvent[] };
  const list = Array.isArray(root.events) ? root.events : Array.isArray(raw) ? (raw as RawEvent[]) : [];
  return list.flatMap((e): EventSummary[] => {
    const id = typeof e.eventId === 'string' ? e.eventId : null;
    const title = typeof e.title === 'string' ? e.title : null;
    if (!id || !title) return [];
    const outcomes: EventOutcome[] = (e.outcomes || []).flatMap((o) => {
      if (!o.marketId || typeof o.yes !== 'number') return [];
      const out: EventOutcome = {
        id: o.marketId,
        name: e.isMultiOutcome ? (o.label || 'outcome') : 'YES',
        price: o.yes,
      };
      if (typeof o.volume24hr === 'number') out.volume24hr = o.volume24hr;
      return [out];
    });
    if (outcomes.length === 0) return [];
    // Sort multi-outcome candidates highest-yes first so the "top 3" preview
    // shows the actual leaders.
    outcomes.sort((a, b) => b.price - a.price);
    const summary: EventSummary = {
      id,
      title: title.toLowerCase(),
      category: typeof e.category === 'string' ? e.category : 'other',
      marketCount: outcomes.length,
      outcomes,
      isMultiOutcome: Boolean(e.isMultiOutcome),
    };
    if (typeof e.totalVolume24hr === 'number') summary.volume24hr = e.totalVolume24hr;
    if (typeof e.endDate === 'string') summary.endDate = e.endDate;
    if (Array.isArray(e.tagSlugs)) {
      const slugs = e.tagSlugs.filter((x): x is string => typeof x === 'string');
      if (slugs.length > 0) summary.tagSlugs = slugs;
    }
    return [summary];
  });
}

// ---------- agent status mapping ----------
// AgentList renders one row per agent in a fixed order matching the
// supervisor topology: market · holders · news · thesis · sentiment ·
// synthesis · ask.
function agentStatesFromBrief(agents: ReturnType<typeof useBrief>['brief']['agents']): AgentStatus[] {
  return [
    agents.market,
    agents.holders,
    agents.news,
    agents.thesis,
    agents.sentiment,
    agents.synthesis,
    agents.ask,
  ];
}

function agentDetailsFromBrief(
  details: ReturnType<typeof useBrief>['brief']['agentDetails'],
): Array<{ error?: string; elapsedMs?: number } | undefined> {
  return [
    details.market,
    details.holders,
    details.news,
    details.thesis,
    details.sentiment,
    details.synthesis,
    details.ask,
  ];
}

// ---------- citation → panel data ----------
// useBrief reduces every agent's citations into one Citation[] union. The
// panels want kind-specific lists. Project them.

function newsCitationsToItems(cits: Citation[]): NewsItem[] {
  return cits
    .filter((c) => c.kind === 'news')
    .map((c) => ({
      id: c.id,
      title: c.label || c.id,
      src: c.url ? new URL(c.url).hostname.replace(/^www\./, '') : 'web',
      when: '',
      ...(c.url ? { url: c.url } : {}),
    }));
}

function comparablesFromCitations(cits: Citation[]): ComparableHit[] {
  return cits
    .filter((c) => c.kind === 'comp')
    .map((c): ComparableHit | null => {
      const p = (c as Citation & { payload?: unknown }).payload as Partial<ComparableHit> | undefined;
      if (!p || typeof p !== 'object') return null;
      if (typeof p.eventId !== 'string' || typeof p.title !== 'string') return null;
      const outcome: 'yes' | 'no' | 'unresolved' =
        p.outcome === 'yes' || p.outcome === 'no' ? p.outcome : 'unresolved';
      const hit: ComparableHit = {
        eventId: p.eventId,
        title: p.title,
        endDate: p.endDate ?? null,
        outcome,
        resolvedPrice: typeof p.resolvedPrice === 'number' ? p.resolvedPrice : null,
        score: typeof p.score === 'number' ? p.score : 0,
      };
      if (typeof p.slug === 'string') hit.slug = p.slug;
      return hit;
    })
    .filter((x): x is ComparableHit => x !== null);
}

function baseRateFromComparables(hits: ComparableHit[]): { yesCount: number; resolvedCount: number; totalCount: number } | null {
  if (hits.length === 0) return null;
  const yesCount = hits.filter((h) => h.outcome === 'yes').length;
  const noCount = hits.filter((h) => h.outcome === 'no').length;
  return { yesCount, resolvedCount: yesCount + noCount, totalCount: hits.length };
}

function kolCitationsToItems(cits: Citation[]): KOLSentimentItem[] {
  const list = cits.filter((c) => c.kind === 'kol');
  if (list.length === 0) return [];
  return list.map((c): KOLSentimentItem => {
    // The sentiment agent stashes {handle, text, url, createdAt} in payload.
    // The label is just "@handle" for compactness — pull the actual tweet
    // text from payload so the panel doesn't echo the handle as the excerpt.
    const payload = (c as Citation & { payload?: unknown }).payload as
      | { handle?: string; text?: string; createdAt?: string }
      | undefined;
    const labelHandle = (c.label || '').replace(/^@/, '');
    const handle = (payload?.handle || labelHandle || '').replace(/^@/, '');
    return {
      id: c.id,
      kol: handle || 'kol',
      handle,
      excerpt: typeof payload?.text === 'string' && payload.text ? payload.text : '',
      when: typeof payload?.createdAt === 'string' ? payload.createdAt : '',
      relevance: 0,
      url: c.url || '',
    };
  });
}

// Render thesis section claims into the research panel's tree shape.
// The agent emits claims with shapes that vary by provider:
//   - `top: <root>` / `Top claim: <root>` / `Conclusion: <root>`
//   - `<sub-claim> (p=0.62)` (probability optional)
//   - `compound: <p> · kill: <text>` / `Summary: ...`
// We tolerate variants and fall back to using the first claim as the root if
// no explicit prefix matched.
const THESIS_ROOT_PATTERNS = [
  /^top\s*:\s*/i,
  /^top\s+claim\s*:\s*/i,
  /^conclusion\s*:\s*/i,
];
const THESIS_COMPOUND_PATTERNS = [
  /^compound\s*:\s*/i,
  /^summary\s*:\s*/i,
  /^kill\s*:\s*/i,
];

// Phrases the thesis agent emits when it bailed (provider returned junk JSON,
// no provider, etc). When only those placeholders are present, we hide the
// panel rather than render them as the root claim.
const THESIS_FAILURE_HINTS = [
  /unstructured output/i,
  /skipping/i,
  /agent disabled/i,
  /no-provider/i,
  /agent failed/i,
];

function thesisFromSection(
  sectionClaims: { text: string; citations: string[] }[] | undefined,
): Thesis | undefined {
  if (!sectionClaims || sectionClaims.length === 0) return undefined;
  let rootLabel = '';
  const nodes: ThesisNode[] = [];
  for (const c of sectionClaims) {
    if (!c.text) continue;
    if (THESIS_FAILURE_HINTS.some((re) => re.test(c.text))) continue;
    const rootMatch = THESIS_ROOT_PATTERNS.find((re) => re.test(c.text));
    if (rootMatch) {
      rootLabel = c.text.replace(rootMatch, '').trim();
      continue;
    }
    if (THESIS_COMPOUND_PATTERNS.some((re) => re.test(c.text))) continue;
    const challengeHint = /\b(no|fails?|falls?|won['’]t|miss(es)?|risk|against)\b/i.test(c.text);
    const node: ThesisNode = {
      kind: challengeHint ? 'challenges' : 'supports',
      label: c.text,
    };
    if (c.citations[0]) node.citationId = c.citations[0];
    nodes.push(node);
  }
  // No explicit root marker → first non-compound claim becomes the root.
  if (!rootLabel && nodes.length > 0) {
    rootLabel = nodes[0]!.label;
    nodes.shift();
  }
  // If we only got a root with no supporting nodes, surface the placeholder
  // so the panel renders "no thesis derived" instead of a lonely claim.
  if (!rootLabel || nodes.length === 0) return undefined;
  return { rootLabel, nodes };
}

// ---------- main app ----------

export function App() {
  const {
    config: providerConfig,
    loading: providerLoading,
    setKey,
    setUseClaudeCode,
    clearKey,
    setPrimaryOverride,
  } = useProvider();
  // Derived: any provider connected (primary computed) → user has set up.
  const hasPrimary = Boolean(providerConfig.primary);
  const providerHealthHook = useProviderHealth();
  const { route, navigate } = useRoute();
  // Wallet + X handle session. Gates the desk behind the LandingFlow
  // until at least a wallet is on file (X handle is optional). Stored
  // in localStorage; cross-tab synced.
  const auth = useAuth();
  // Default tab matches LeftRail's initial active tab so the first fetch
  // returns events the LeftRail filter will actually accept. Bug history:
  // LeftRail defaulted to 'politics' but App.tsx fetched 'crypto', so the
  // initial render said "no politics markets match" until the user clicked
  // a tab.
  const [category, setCategory] = useState<string>('politics');

  const { events: rawEvents, loading: eventsLoading } = useEventsList({
    category,
    limit: 80,
    mode: 'contested',
  });
  const events = useMemo(() => normaliseEvents(rawEvents), [rawEvents]);

  // marketId comes from URL when route is /m/:id; otherwise blank.
  const selectedMarketId = route.name === 'market' ? route.marketId : null;

  // Shared "resolve a Polymarket URL → marketId → navigate" handler. Used
  // both by the EmptyState's paste hint and by the LeftRail's search box
  // (so users can paste a market link from anywhere and land on its brief
  // instead of needing to scroll the events list). Returns true on success
  // so the search box can clear itself.
  const resolvePolymarketUrl = useCallback(
    async (url: string): Promise<boolean> => {
      const trimmed = url.trim();
      if (!trimmed.includes('polymarket.com/')) return false;
      try {
        const r = await fetch(`/api/resolve?url=${encodeURIComponent(trimmed)}`);
        if (!r.ok) return false;
        const j = (await r.json()) as { marketId?: string; eventId?: string };
        if (j.marketId) {
          navigate({ name: 'market', marketId: j.marketId });
          return true;
        }
        // Some Polymarket links resolve to an event with multiple sub-markets
        // (no single market URL). The /api/resolve endpoint already picks the
        // top-volume sub-market when that happens; if the response still has
        // no marketId we surface false so the caller can show an error.
        return false;
      } catch {
        return false;
      }
    },
    [navigate],
  );

  // useBrief is no longer SSE-backed (cf-azure-rewrite). loadState
  // replaces sseState; same role, simpler shape (idle | loading | ready
  // | error). The old isLoading + errored derivations below adjust to
  // the new field names.
  const { brief, loadState, reconnect: reconnectBrief } = useBrief(selectedMarketId);

  // For multi-outcome events, find the parent event so the market panel
  // can offer outcome-switching tabs. We look in two places:
  //   1) the currently-loaded events list (free, in-memory)
  //   2) /api/event?id=<eventId> using the eventId on the loaded brief
  //      (handles cases where the parent isn't in the current category tab —
  //      e.g. user navigated via /m/:id or recently-viewed)
  const parentEventLocal = useMemo(() => {
    if (!selectedMarketId) return null;
    return events.find((e) => e.outcomes.some((o) => o.id === selectedMarketId)) ?? null;
  }, [events, selectedMarketId]);
  const briefEventId = useMemo(() => {
    const raw = brief.rawMarket;
    if (!raw || typeof raw !== 'object') return null;
    const eid = (raw as { eventId?: unknown }).eventId;
    return typeof eid === 'string' ? eid : null;
  }, [brief.rawMarket]);
  const fetchedParentEvent = useFetchedEvent(briefEventId, parentEventLocal !== null);
  const parentEvent: EventSummary | null = parentEventLocal ?? fetchedParentEvent;

  const watchlist = useWatchlist();

  // Wallet from localStorage (entered once in PositionsTab) so positions persist.
  // The right-rail Positions tab still owns its own wallet override
  // (paste a different address to inspect someone else's positions),
  // but the canonical default is the auth wallet from the LandingFlow.
  // Hydrate from auth.wallet first; fall back to the legacy
  // pm-copilot:wallet key for users who set up before the LandingFlow
  // shipped. Effect below keeps the two in sync when auth.wallet changes.
  const [wallet, setWallet] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return (
      window.localStorage.getItem('pm-copilot:auth:wallet') ||
      window.localStorage.getItem('pm-copilot:wallet') ||
      ''
    );
  });
  // Sync auth-side wallet → local wallet ONLY when auth.wallet itself
  // changes (sign-in, cross-tab change). Don't depend on `wallet` here —
  // the right-rail override input mutates `wallet` directly and we don't
  // want to clobber that override every time the user types.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (auth.wallet) setWallet(auth.wallet);
  }, [auth.wallet]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (wallet) window.localStorage.setItem('pm-copilot:wallet', wallet);
    else window.localStorage.removeItem('pm-copilot:wallet');
  }, [wallet]);

  const { positions } = usePositions(wallet || null);
  const recents = useRecentlyViewed();
  const ask = useAsk(brief.rawMarket);

  // Push a recent entry whenever we settle on a market we have data for.
  useEffect(() => {
    if (selectedMarketId && brief.market && brief.market.id === selectedMarketId) {
      const m = brief.market;
      recents.push({ ...m, category: category || 'other' });
    }
  }, [selectedMarketId, brief.market, category, recents]);

  // UI state
  const [focusedPanel, setFocusedPanel] = useState<PanelKey | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Rails collapsed state — persisted in localStorage so toggling once
  // sticks across reloads. Lazy initializer reads on mount; an effect
  // writes on each change. Same pattern as the resizable grid height.
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('pm-copilot:left-collapsed') === '1';
  });
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('pm-copilot:right-collapsed') === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('pm-copilot:left-collapsed', leftCollapsed ? '1' : '0');
  }, [leftCollapsed]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('pm-copilot:right-collapsed', rightCollapsed ? '1' : '0');
  }, [rightCollapsed]);
  const [flashId, setFlashId] = useState<string | null>(null);
  // Resizable evidence-grid height. Persisted in localStorage so the user
  // doesn't have to re-drag every session. null = follow CSS default.
  const [evidenceGridHeight, setEvidenceGridHeight] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem('pm-copilot:grid-height');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const persistGridHeight = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (evidenceGridHeight == null) {
      window.localStorage.removeItem('pm-copilot:grid-height');
    } else {
      window.localStorage.setItem('pm-copilot:grid-height', String(evidenceGridHeight));
    }
  }, [evidenceGridHeight]);
  // Setup overlay. When the user clicks "providers" in the right rail, we
  // open this as a modal on top of the workbench (instead of routing away,
  // which was causing the workbench to unmount and feel like a full reload).
  // The /setup URL still works for the first-load gate.
  const [setupOpen, setSetupOpen] = useState(false);
  // Keyboard help modal — toggled by `?` (when no input is focused).
  const [helpOpen, setHelpOpen] = useState(false);

  const onFlash = useCallback((id: string) => {
    setFlashId(null);
    requestAnimationFrame(() => {
      setFlashId(id);
      flashCitation(id);
    });
  }, []);

  // First-load gate: send to /setup unless the user has explicitly skipped
  // (stored as `pm-copilot:setup-skipped` in localStorage when they pick the
  // "use local claude code" path). This way new users land on the picker;
  // returning users with a key (or who skipped) go straight to the desk.
  //
  // Server-configured fallback: if /api/health/providers reports an env-
  // baked primary (e.g. OPENAI_API_KEY in Container Apps secrets), treat
  // the deploy as already "free for everyone" — auto-skip setup so users
  // land straight on the workbench. They can still open setup later to
  // BYOK their own key.
  useEffect(() => {
    if (providerLoading) return;
    if (typeof window === 'undefined') return;
    const skipped = window.localStorage.getItem('pm-copilot:setup-skipped') === '1';
    const noKey = !hasPrimary;
    const env = providerHealthHook.health?.env;
    const serverHasPrimary = !!(env && (env.openai || env.anthropic || env.google || env.xai));
    if (noKey && !skipped && !serverHasPrimary && route.name !== 'setup') {
      navigate({ name: 'setup' });
    } else if (noKey && !skipped && serverHasPrimary) {
      // Persist the auto-skip so subsequent loads bypass the setup gate
      // even before the providers probe returns. If we're currently parked
      // on /setup (because the probe hadn't returned yet on first paint),
      // also bounce home so the user doesn't see the setup screen flash.
      window.localStorage.setItem('pm-copilot:setup-skipped', '1');
      if (route.name === 'setup') navigate({ name: 'home' });
    } else if (!noKey && route.name === 'setup') {
      navigate({ name: 'home' });
    }
  }, [providerLoading, hasPrimary, providerHealthHook.health, route.name, navigate]);

  // Auto-promote claude-code to primary when:
  //   1. The local subprocess is reachable (health check passed), AND
  //   2. No primary is currently configured (no paste-key + no marker), AND
  //   3. The user previously dismissed setup (so we don't pre-empt their choice)
  // This handles the migration case where the marker-write code didn't exist
  // when the user first dismissed setup, plus the cold-boot UX for new users
  // who already have Claude Code running. Once set, the next setup-modal open
  // shows the tile as "✓ connected" without any extra click.
  const autoPromotedRef = useRef(false);
  useEffect(() => {
    if (autoPromotedRef.current) return;
    if (providerLoading) return;
    if (typeof window === 'undefined') return;
    const ccReachable = providerHealthHook.health?.checks?.['claude-code']?.ok === true;
    if (!ccReachable) return;
    if (providerConfig.primary !== null) return;
    const skipped = window.localStorage.getItem('pm-copilot:setup-skipped') === '1';
    if (!skipped) return;
    autoPromotedRef.current = true;
    void setUseClaudeCode();
  }, [providerLoading, providerHealthHook.health, providerConfig.primary, setUseClaudeCode]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); return; }
      if (meta && e.key === '1') { e.preventDefault(); setFocusedPanel((p) => p === 'market' ? null : 'market'); return; }
      if (meta && e.key === '2') { e.preventDefault(); setFocusedPanel((p) => p === 'research' ? null : 'research'); return; }
      if (meta && e.key === '[') { e.preventDefault(); setLeftCollapsed((c) => !c); return; }
      if (meta && e.key === ']') { e.preventDefault(); setRightCollapsed((c) => !c); return; }
      if (meta && e.key.toLowerCase() === 'b' && selectedMarketId && brief.market) {
        e.preventDefault();
        const item: WatchItem = {
          marketId: selectedMarketId,
          title: brief.market.title,
          price: brief.market.yes ?? 0,
          delta: '+0.00',
        };
        if (watchlist.has(selectedMarketId)) watchlist.remove(selectedMarketId);
        else watchlist.add(item);
        return;
      }
      // `?` opens the keyboard cheat sheet — skip if the user is typing in
      // an input/textarea/contentEditable surface (the search box, chat,
      // setup keyfields). Same guard pattern shipped trading terminals use.
      if (e.key === '?') {
        const tgt = e.target as HTMLElement | null;
        const tag = tgt?.tagName;
        const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (tgt?.isContentEditable ?? false);
        if (!isTyping) {
          e.preventDefault();
          setHelpOpen((o) => !o);
          return;
        }
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedMarketId, brief.market, watchlist]);

  // ---------- derive everything BEFORE any early-return so hook order is
  // stable across the providerLoading / setup / home branches. (React's
  // Rules of Hooks: every render must call the same hooks in the same order.)
  const market: Market | null = brief.market;

  const verdictSections = useMemo(
    () => deriveVerdictStats({ market, bookRows: brief.bookRows, holderRows: brief.holderRows }),
    [market, brief.bookRows, brief.holderRows],
  );

  const paletteItems = useMemo(
    () => [
      { id: 'focus-market', label: 'focus market panel (book + holders)', kbd: '⌘1', run: () => setFocusedPanel((p) => p === 'market' ? null : 'market') },
      { id: 'focus-research', label: 'focus research panel (news + sentiment + thesis + comparables)', kbd: '⌘2', run: () => setFocusedPanel((p) => p === 'research' ? null : 'research') },
      { id: 'toggle-left', label: 'toggle left rail', kbd: '⌘[', run: () => setLeftCollapsed((c) => !c) },
      { id: 'toggle-right', label: 'toggle right rail', kbd: '⌘]', run: () => setRightCollapsed((c) => !c) },
      { id: 'go-home', label: 'go home (clear selection)', run: () => navigate({ name: 'home' }) },
      { id: 'open-setup', label: 'open setup / change provider', run: () => navigate({ name: 'setup' }) },
      { id: 'add-watchlist', label: 'add current market to watchlist', kbd: '⌘B', run: () => {
        if (!selectedMarketId || !brief.market) return;
        const item: WatchItem = {
          marketId: selectedMarketId,
          title: brief.market.title,
          price: brief.market.yes ?? 0,
          delta: '+0.00',
        };
        if (watchlist.has(selectedMarketId)) watchlist.remove(selectedMarketId);
        else watchlist.add(item);
      } },
    ],
    [selectedMarketId, brief.market, watchlist, navigate],
  );

  // ---------- rendering ----------

  if (providerLoading) {
    return (
      <main className="app-shell">
        <div className="empty-state"><div className="empty-card"><div className="empty-title">loading…</div></div></div>
      </main>
    );
  }

  // Auth gate. signedIn = wallet set AND onboardingComplete. The
  // separate onboardingComplete flag keeps LandingFlow mounted across
  // all 4 stages (landing → wallet → twitter → handoff). Without it,
  // setting the wallet in stage 2 would immediately flip the gate and
  // unmount the flow, skipping the Twitter screen entirely.
  if (!auth.signedIn) {
    // Pass the auth functions directly (they're already useCallback'd
    // inside useAuth, so the references are stable across renders).
    // Earlier this site had inline arrows, which created a fresh function
    // every App render — LandingFlow's handoff useEffect deps included
    // `onHandoffComplete`, so each parent re-render was clearing +
    // restarting the 700ms interval, leaving the user stuck on
    // "priming agents." indefinitely.
    return (
      <LandingFlow
        onConnectWallet={auth.setWallet}
        onSubmitHandle={auth.setXHandle}
        onHandoffComplete={auth.completeOnboarding}
      />
    );
  }

  // Setup overlay (rendered after the main return below). The /setup URL
  // also opens it; saving from URL-mode also navigates back to home so the
  // address bar matches.
  const showSetup = setupOpen || route.name === 'setup';
  const onSetupSave = async (info: { provider: ProviderName; key: string }) => {
    // Schema v2: each provider has its own key slot, so a paste only writes
    // to that one slot — no overwrite of other providers. The orchestrator
    // (primary) is computed by auto-rank; the user can override per-tile
    // via the "use as primary" button.
    await setKey(info.provider, info.key);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('pm-copilot:setup-skipped');
    }
    // Close behavior depends on entry path:
    //  - Adjustment (providers button → setupOpen=true): close on any save.
    //  - First-time gate (route.name='setup'): close once any primary-
    //    eligible provider is connected (perplexity-only keeps it open).
    if (setupOpen) {
      setSetupOpen(false);
      return;
    }
    if (info.provider !== 'perplexity' && route.name === 'setup') {
      navigate({ name: 'home' });
    }
  };
  const onSetupSkip = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('pm-copilot:setup-skipped', '1');
    }
    setSetupOpen(false);
    if (route.name === 'setup') navigate({ name: 'home' });
  };
  // When the user picks the claude-code tile we register anthropic-cc as the
  // primary provider so the tile renders with a "✓ connected" badge on
  // subsequent setup-modal opens. Claude Code itself doesn't need a key — the
  // server detects the marker and routes via the subprocess.
  const onUseClaudeCode = async () => {
    await setUseClaudeCode();
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('pm-copilot:setup-skipped', '1');
    }
    setSetupOpen(false);
    if (route.name === 'setup') navigate({ name: 'home' });
  };

  // Find positions matching the current selected market (for the strip above the verdict band).
  const matchingPositions = selectedMarketId
    ? positions.filter((p) => p.market === selectedMarketId || p.conditionId === selectedMarketId)
    : [];

  const errorPanel: PanelKey | null = brief.errors.length > 0 && !market ? 'research' : null;
  const isLoading = loadState === 'loading' && Boolean(selectedMarketId);
  const isEmpty = !selectedMarketId;

  // Project brief data into panel-ready shapes. Prefer real grounding from
  // the supervisor's `agent:data` events; fall back to citation-derived items
  // (titles only) when grounding hasn't streamed yet.
  const newsCatalysts = brief.newsItems.length > 0
    ? brief.newsItems
    : newsCitationsToItems(brief.citations);
  const sentimentItems = kolCitationsToItems(brief.citations);
  // Sentiment tab is greyed unless the user has the xAI key configured.
  const sentimentForPanel = providerConfig.hasXai
    ? sentimentItems
    : null;
  const thesisSection = brief.sections.find((s) => s.id === 'thesis');
  const thesisForPanel = thesisFromSection(thesisSection?.claims);
  const comparablesForPanel = comparablesFromCitations(brief.citations);
  const baseRateForPanel = baseRateFromComparables(comparablesForPanel);
  const resolutionText = market?.criteria || '';

  // For multi-outcome events, find the parent event in the events list (purely
  // derived — useMemo only because it's an O(N*M) scan and we don't want to
  // re-run on unrelated re-renders).
  const showOutcomeTabs = !!parentEvent && parentEvent.isMultiOutcome === true && parentEvent.outcomes.length > 1;

  return (
    <div className={`app ${leftCollapsed ? 'no-left' : ''} ${rightCollapsed ? 'no-right' : ''} ${isEmpty ? 'empty' : ''}`}>
      {isLoading && <LoadingToast />}

      <LeftRail
        selectedId={selectedMarketId}
        onSelect={(id) => navigate({ name: 'market', marketId: id })}
        collapsed={leftCollapsed}
        events={events}
        onCategoryChange={(c) => setCategory(c)}
        loading={eventsLoading}
        onHome={() => navigate({ name: 'home' })}
        onResolveUrl={resolvePolymarketUrl}
      />

      <main className="workbench">
        {isEmpty ? (
          <EmptyState
            recents={recents.list.map((r) => ({
              marketId: r.marketId,
              name: r.title,
              meta: `${r.yes != null ? r.yes.toFixed(2) + ' yes · ' : ''}${r.resolveIn}`,
              cat: r.category,
            }))}
            onPaste={async (url) => { void resolvePolymarketUrl(url); }}
            onPickRecent={(marketId) => navigate({ name: 'market', marketId })}
          />
        ) : !market ? (
          loadState === 'error' || brief.errors.length > 0 ? (
            <ErrorState message={brief.errors[0] || 'failed to fetch brief'} />
          ) : (
            <div className="loading-shell">
              <LoadingToast />
            </div>
          )
        ) : (
          <>
            <MarketHeader
              market={market}
              inWatchlist={selectedMarketId ? watchlist.has(selectedMarketId) : false}
              onToggleWatchlist={
                selectedMarketId
                  ? () => {
                      const item: WatchItem = {
                        marketId: selectedMarketId,
                        title: market.title,
                        price: market.yes ?? 0,
                        delta: '+0.00',
                      };
                      if (watchlist.has(selectedMarketId)) watchlist.remove(selectedMarketId);
                      else watchlist.add(item);
                    }
                  : undefined
              }
            />
            <EvidenceGrid
              focusedPanel={focusedPanel}
              onFocus={(k) => setFocusedPanel((p) => p === k ? null : k)}
              onFlash={onFlash}
              flashId={flashId}
              errorPanel={errorPanel}
              loading={isLoading}
              agents={brief.agents}
              {...(brief.bookRows.length ? { bookRows: brief.bookRows } : {})}
              {...(brief.holderRows.length ? { holderRows: brief.holderRows } : {})}
              {...(newsCatalysts.length ? { catalysts: newsCatalysts } : {})}
              sentiment={sentimentForPanel}
              resolution={resolutionText}
              {...(thesisForPanel ? { thesis: thesisForPanel } : {})}
              {...(comparablesForPanel.length ? { comparables: comparablesForPanel } : {})}
              {...(baseRateForPanel ? { baseRate: baseRateForPanel } : {})}
              {...(showOutcomeTabs && parentEvent
                ? {
                    outcomes: parentEvent.outcomes,
                    selectedOutcomeId: selectedMarketId,
                    onOutcomeSelect: (id: string) =>
                      navigate({ name: 'market', marketId: id }),
                  }
                : {})}
              {...(evidenceGridHeight != null ? { heightPx: evidenceGridHeight } : {})}
              onRetry={reconnectBrief}
              onSwitchProvider={() => setSetupOpen(true)}
            />
            <ResizeHandle
              currentHeight={evidenceGridHeight ?? 520}
              min={200}
              max={Math.max(400, typeof window !== 'undefined' ? window.innerHeight - 240 : 800)}
              onResize={(h) => setEvidenceGridHeight(h)}
              onResizeEnd={persistGridHeight}
            />
            <PositionStrip matches={matchingPositions} />
            <VerdictBand
              sections={verdictSections}
              citationCount={brief.citations.length}
            />
            <Chat
              messages={ask.messages}
              onSend={(text) => { void ask.send(text); }}
              busy={ask.busy}
            />
          </>
        )}
      </main>

      <RightRail
        collapsed={rightCollapsed}
        agentStates={(() => {
          const states = agentStatesFromBrief(brief.agents);
          // Override the ask slot (last position) with live ask-hook state.
          // Brief never updates ask; the chat does. This keeps the rail in
          // sync with what the user sees in the chat box.
          if (ask.runStatus === 'running') states[6] = 'running';
          else if (ask.runStatus === 'done') states[6] = 'done';
          else if (ask.runStatus === 'error') states[6] = 'error';
          return states;
        })()}
        agentDetails={(() => {
          const details = agentDetailsFromBrief(brief.agentDetails);
          // Provide elapsed time for the ask row so it shows "running… · 4.2s"
          // while in flight and "DONE · 12.1s" when the answer lands.
          if (ask.runStatus === 'running' && ask.runElapsedMs != null) {
            details[6] = { elapsedMs: ask.runElapsedMs };
          } else if (ask.runStatus === 'done' && ask.lastElapsedMs != null) {
            details[6] = { elapsedMs: ask.lastElapsedMs };
          } else if (ask.runStatus === 'error' && ask.lastElapsedMs != null) {
            details[6] = { elapsedMs: ask.lastElapsedMs, error: ask.error ?? 'ask failed' };
          }
          return details;
        })()}
        watchlist={watchlist.list}
        onWatchlistRemove={watchlist.remove}
        recents={recents.list.map((r) => ({ marketId: r.marketId, title: r.title, yes: r.yes }))}
        onRecentSelect={(marketId) => navigate({ name: 'market', marketId })}
        wallet={wallet}
        positions={positions}
        onWalletChange={setWallet}
        onOpenSetup={() => setSetupOpen(true)}
        providerSummary={{
          primary: providerConfig.primary,
          perplexity: providerConfig.hasPerplexity,
          xai: providerConfig.hasXai,
        }}
        providerHealth={{
          data: providerHealthHook.health,
          loading: providerHealthHook.loading,
          error: providerHealthHook.error,
          lastCheckedAt: providerHealthHook.lastCheckedAt,
          onRecheck: providerHealthHook.recheck,
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
      />

      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      {showSetup && (
        <SetupScreen
          onConfigured={onSetupSave}
          onSkip={onSetupSkip}
          onUseClaudeCode={() => { void onUseClaudeCode(); }}
          configured={providerConfig}
          claudeCodeReachable={
            providerHealthHook.health?.checks?.['claude-code']?.ok ?? undefined
          }
          envProviders={providerHealthHook.health?.env}
          onRemove={(provider) => { void clearKey(provider); }}
          onSetPrimary={(provider) => { void setPrimaryOverride(provider); }}
          // First-load gate (route='setup' + nothing configured): force a
          // choice. Right-rail providers overlay (setupOpen=true) is freely
          // dismissible because the workbench is already usable.
          requireChoice={route.name === 'setup' && !hasPrimary}
        />
      )}
    </div>
  );
}
