// EvidenceGrid — 1x2 panels: market (book + holders) | research (catalysts +
// sentiment + thesis + comparables + resolution).
//
// Was a 2x2 grid. The user asked for the two structural-data sections to
// share a box (book + holders, internal tabs) and for thesis to live inside
// the news panel — so the grid collapses to two boxes total.

import { Panel, type PanelKey } from './Panel';
import { MarketPanel } from './MarketPanel';
import { NewsPanel } from './NewsPanel';
import type {
  BookRow,
  ComparableHit,
  EventOutcome,
  HolderRow,
  KOLSentimentItem,
  NewsItem,
  Thesis,
} from '../../types';

export interface EvidenceGridProps {
  focusedPanel: PanelKey | null;
  onFocus: (k: PanelKey) => void;
  onFlash: (id: string) => void;
  flashId: string | null;
  errorPanel?: PanelKey | null;
  loading: boolean;
  bookRows?: BookRow[];
  holderRows?: HolderRow[];
  catalysts?: NewsItem[];
  sentiment?: KOLSentimentItem[] | null;
  resolution?: string;
  thesis?: Thesis;
  comparables?: ComparableHit[];
  baseRate?: { yesCount: number; resolvedCount: number; totalCount: number } | null;
  /** Sibling outcomes for multi-outcome events. When supplied (length > 1)
   *  the market panel renders an "outcomes" tab listing all candidates with
   *  prices; clicking a candidate navigates to that outcome's market. */
  outcomes?: EventOutcome[];
  selectedOutcomeId?: string | null;
  onOutcomeSelect?: (marketId: string) => void;
  /** When set, overrides the default min(55vh, 620px) cap so the user can
   *  drag-resize the panels block taller or shorter. */
  heightPx?: number;
}

export function EvidenceGrid({
  focusedPanel,
  onFocus,
  onFlash,
  flashId,
  errorPanel,
  loading,
  bookRows,
  holderRows,
  catalysts,
  sentiment = null,
  resolution = '',
  thesis,
  comparables,
  baseRate,
  outcomes,
  selectedOutcomeId,
  onOutcomeSelect,
  heightPx,
}: EvidenceGridProps) {
  // Per-panel loading: keep the skeleton up only until that panel's data
  // (or fallback) is available.
  const marketLoading =
    loading &&
    (!bookRows || bookRows.length === 0) &&
    (!holderRows || holderRows.length === 0);
  // Research panel flips out of skeleton as soon as ANY of its sub-feeds
  // (news / sentiment / thesis / comparables) returns data, so the user
  // gets something visible quickly instead of waiting for the slowest.
  const researchLoading =
    loading &&
    (!catalysts || catalysts.length === 0) &&
    (!sentiment || sentiment.length === 0) &&
    !thesis &&
    (!comparables || comparables.length === 0);

  const marketSub = (() => {
    const parts: string[] = [];
    if (bookRows?.length) parts.push(`${bookRows.length} levels`);
    if (holderRows?.length) parts.push(`top ${holderRows.length}`);
    return parts.length ? parts.join(' · ') : 'awaiting data';
  })();

  const researchSub = (() => {
    const parts: string[] = [];
    if (catalysts?.length) parts.push(`${catalysts.length} news`);
    if (sentiment?.length) parts.push(`${sentiment.length} kol`);
    if (thesis) parts.push(`${thesis.nodes.length} thesis nodes`);
    if (comparables?.length) parts.push(`${comparables.length} comp`);
    return parts.length ? parts.join(' · ') : 'awaiting research';
  })();

  const style = heightPx != null ? { height: `${heightPx}px` } : undefined;

  return (
    <div
      className={`evidence-grid focus-${focusedPanel ?? 'none'}`}
      style={style}
    >
      <Panel
        title="market"
        sub={marketSub}
        panelKey="market"
        focused={focusedPanel === 'market'}
        errored={errorPanel === 'market'}
        loading={marketLoading}
        onFocus={onFocus}
      >
        <MarketPanel
          flashId={flashId}
          {...(bookRows ? { bookRows } : {})}
          {...(holderRows ? { holderRows } : {})}
          {...(outcomes && outcomes.length > 1 ? { outcomes } : {})}
          {...(selectedOutcomeId ? { selectedOutcomeId } : {})}
          {...(onOutcomeSelect ? { onOutcomeSelect } : {})}
        />
      </Panel>
      <Panel
        title="research"
        sub={researchSub}
        panelKey="research"
        focused={focusedPanel === 'research'}
        errored={errorPanel === 'research'}
        loading={researchLoading}
        onFocus={onFocus}
      >
        <NewsPanel
          flashId={flashId}
          onFlash={onFlash}
          {...(catalysts ? { catalysts } : {})}
          sentiment={sentiment}
          resolution={resolution}
          {...(thesis ? { thesis } : {})}
          {...(comparables && comparables.length > 0 ? { comparables } : {})}
          {...(baseRate ? { baseRate } : {})}
        />
      </Panel>
    </div>
  );
}
