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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LeftRail } from './components/LeftRail/LeftRail';
import { MarketHeader } from './components/MarketHeader/MarketHeader';
import { EvidenceGrid } from './components/EvidenceGrid/EvidenceGrid';
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

import { useEventsList } from './hooks/useEventsList';
import { useBrief } from './hooks/useBrief';
import { useProvider } from './hooks/useProvider';
import { useWatchlist } from './hooks/useWatchlist';
import { usePositions } from './hooks/usePositions';
import { useRecentlyViewed } from './hooks/useRecentlyViewed';
import { useAsk } from './hooks/useAsk';
import { useRoute } from './lib/routing';
import { flashCitation } from './lib/citationFlash';
import { deriveVerdictStats } from './lib/derivedStats';

import type {
  AgentStatus,
  Citation,
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
  isMultiOutcome?: boolean;
  outcomes?: RawEventOutcome[];
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
      return [{
        id: o.marketId,
        name: e.isMultiOutcome ? (o.label || 'outcome') : 'YES',
        price: o.yes,
      }];
    });
    if (outcomes.length === 0) return [];
    return [{
      id,
      title: title.toLowerCase(),
      category: typeof e.category === 'string' ? e.category : 'other',
      marketCount: outcomes.length,
      outcomes,
    }];
  });
}

// ---------- agent status mapping ----------
// AgentDots renders 7 dots in a fixed order matching the supervisor topology:
// market · holders · news · thesis · sentiment · synthesis · ask.
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

function kolCitationsToItems(cits: Citation[]): KOLSentimentItem[] {
  const list = cits.filter((c) => c.kind === 'kol');
  if (list.length === 0) return [];
  return list.map((c) => {
    const handle = (c.label || '').replace(/^@/, '');
    return {
      id: c.id,
      kol: handle || 'kol',
      handle,
      excerpt: c.label || '',
      when: '',
      relevance: 0,
      url: c.url || '',
    };
  });
}

// Render thesis section claims into the ThesisPanel's tree shape.
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

function thesisFromSection(
  sectionClaims: { text: string; citations: string[] }[] | undefined,
): Thesis | undefined {
  if (!sectionClaims || sectionClaims.length === 0) return undefined;
  let rootLabel = '';
  const nodes: ThesisNode[] = [];
  for (const c of sectionClaims) {
    if (!c.text) continue;
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
  if (!rootLabel && nodes.length === 0) return undefined;
  return { rootLabel: rootLabel || 'thesis', nodes };
}

// ---------- main app ----------

export function App() {
  const { config: providerConfig, loading: providerLoading, setKey } = useProvider();
  const { route, navigate } = useRoute();
  const [category, setCategory] = useState<string>('crypto');

  const { events: rawEvents, loading: eventsLoading } = useEventsList({
    category,
    limit: 80,
    mode: 'contested',
  });
  const events = useMemo(() => normaliseEvents(rawEvents), [rawEvents]);

  // marketId comes from URL when route is /m/:id; otherwise blank.
  const selectedMarketId = route.name === 'market' ? route.marketId : null;

  const { brief, sseState } = useBrief(selectedMarketId);

  const watchlist = useWatchlist();

  // Wallet from localStorage (entered once in PositionsTab) so positions persist.
  const [wallet, setWallet] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('pm-copilot:wallet') || '';
  });
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
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);

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
  useEffect(() => {
    if (providerLoading) return;
    if (typeof window === 'undefined') return;
    const skipped = window.localStorage.getItem('pm-copilot:setup-skipped') === '1';
    const noKey = !providerConfig.hasPrimaryKey;
    if (noKey && !skipped && route.name !== 'setup') {
      navigate({ name: 'setup' });
    } else if (!noKey && route.name === 'setup') {
      navigate({ name: 'home' });
    }
  }, [providerLoading, providerConfig.hasPrimaryKey, route.name, navigate]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); return; }
      if (meta && e.key === '1') { e.preventDefault(); setFocusedPanel((p) => p === 'book' ? null : 'book'); return; }
      if (meta && e.key === '2') { e.preventDefault(); setFocusedPanel((p) => p === 'holders' ? null : 'holders'); return; }
      if (meta && e.key === '3') { e.preventDefault(); setFocusedPanel((p) => p === 'news' ? null : 'news'); return; }
      if (meta && e.key === '4') { e.preventDefault(); setFocusedPanel((p) => p === 'thesis' ? null : 'thesis'); return; }
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
      if (e.key === 'Escape') {
        setPaletteOpen(false);
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
      { id: 'focus-book', label: 'focus book panel', kbd: '⌘1', run: () => setFocusedPanel((p) => p === 'book' ? null : 'book') },
      { id: 'focus-holders', label: 'focus holders panel', kbd: '⌘2', run: () => setFocusedPanel((p) => p === 'holders' ? null : 'holders') },
      { id: 'focus-news', label: 'focus news panel', kbd: '⌘3', run: () => setFocusedPanel((p) => p === 'news' ? null : 'news') },
      { id: 'focus-thesis', label: 'focus thesis panel', kbd: '⌘4', run: () => setFocusedPanel((p) => p === 'thesis' ? null : 'thesis') },
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

  if (route.name === 'setup') {
    return (
      <SetupScreen
        onConfigured={async (info: { provider: ProviderName; key: string }) => {
          await setKey('primary', info.provider, info.key);
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem('pm-copilot:setup-skipped');
          }
          navigate({ name: 'home' });
        }}
        onSkip={() => {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem('pm-copilot:setup-skipped', '1');
          }
          navigate({ name: 'home' });
        }}
      />
    );
  }

  // Find positions matching the current selected market (for the strip above the verdict band).
  const matchingPositions = selectedMarketId
    ? positions.filter((p) => p.market === selectedMarketId || p.conditionId === selectedMarketId)
    : [];

  const errorPanel: PanelKey | null = brief.errors.length > 0 && !market ? 'news' : null;
  const isLoading = sseState !== 'idle' && sseState !== 'closed' && !brief.complete && Boolean(selectedMarketId);
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
  const resolutionText = market?.criteria || '';

  return (
    <div className={`app ${leftCollapsed ? 'no-left' : ''} ${rightCollapsed ? 'no-right' : ''} ${isEmpty ? 'empty' : ''}`}>
      {isLoading && <LoadingToast />}

      <LeftRail
        selectedId={selectedMarketId}
        onSelect={(id) => navigate({ name: 'market', marketId: id })}
        collapsed={leftCollapsed}
        events={events}
        onCategoryChange={(c) => setCategory(c)}
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
            onPaste={async (url) => {
              const trimmed = url.trim();
              if (!trimmed.includes('polymarket.com/')) return;
              try {
                const r = await fetch(`/api/resolve?url=${encodeURIComponent(trimmed)}`);
                if (!r.ok) return;
                const j = (await r.json()) as { marketId?: string };
                if (j.marketId) navigate({ name: 'market', marketId: j.marketId });
              } catch {
                /* swallow — user can pick from the rail */
              }
            }}
            onPickRecent={(marketId) => navigate({ name: 'market', marketId })}
          />
        ) : !market ? (
          sseState === 'error' || brief.errors.length > 0 ? (
            <ErrorState message={brief.errors[0] || 'failed to fetch brief'} />
          ) : (
            <div className="loading-shell">
              <LoadingToast />
            </div>
          )
        ) : (
          <>
            <MarketHeader market={market} />
            <EvidenceGrid
              focusedPanel={focusedPanel}
              onFocus={(k) => setFocusedPanel((p) => p === k ? null : k)}
              onFlash={onFlash}
              flashId={flashId}
              errorPanel={errorPanel}
              loading={isLoading}
              {...(brief.bookRows.length ? { bookRows: brief.bookRows } : {})}
              {...(brief.holderRows.length ? { holderRows: brief.holderRows } : {})}
              {...(newsCatalysts.length ? { catalysts: newsCatalysts } : {})}
              sentiment={sentimentForPanel}
              resolution={resolutionText}
              {...(thesisForPanel ? { thesis: thesisForPanel } : {})}
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
        agentStates={agentStatesFromBrief(brief.agents)}
        watchlist={watchlist.list}
        onWatchlistRemove={watchlist.remove}
        wallet={wallet}
        positions={positions}
        onWalletChange={setWallet}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
      />
    </div>
  );
}
