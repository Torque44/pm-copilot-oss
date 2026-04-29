// EvidenceGrid — 2x2 panels: book / holders / news / thesis.
// Each panel is a focus target for ⌘1-4. Clicking a citation pill flashes the matching source row.

import { Panel, type PanelKey } from './Panel';
import { BookPanel } from './BookPanel';
import { HoldersPanel } from './HoldersPanel';
import { NewsPanel } from './NewsPanel';
import { ThesisPanel } from './ThesisPanel';
import type {
  BookRow,
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
}: EvidenceGridProps) {
  // Per-panel loading: keep the skeleton up only until that panel's data
  // (or fallback) is available. Once grounding arrives for one agent, that
  // panel switches out of skeleton even if the rest of the brief is still
  // streaming.
  const bookLoading = loading && (!bookRows || bookRows.length === 0);
  const holdersLoading = loading && (!holderRows || holderRows.length === 0);
  const newsLoading = loading && (!catalysts || catalysts.length === 0);
  const thesisLoading = loading && !thesis;

  // Subheaders derived from the actual data (or "—" placeholders before
  // grounding arrives). Avoids the previous design-bundle mock strings like
  // "28 levels · 3m ago" that lied about the real shape.
  const bookSub = bookRows && bookRows.length > 0
    ? `${bookRows.length} levels`
    : 'awaiting orderbook';
  const holdersSub = holderRows && holderRows.length > 0
    ? `top ${holderRows.length}`
    : 'awaiting top holders';
  const newsSub = catalysts && catalysts.length > 0
    ? `${catalysts.length} catalyst${catalysts.length === 1 ? '' : 's'}`
    : 'awaiting catalysts';
  const thesisSub = thesis
    ? `${thesis.nodes.length} node${thesis.nodes.length === 1 ? '' : 's'}`
    : 'awaiting thesis';

  return (
    <div className={`evidence-grid focus-${focusedPanel ?? 'none'}`}>
      <Panel
        title="book"
        sub={bookSub}
        panelKey="book"
        focused={focusedPanel === 'book'}
        errored={errorPanel === 'book'}
        loading={bookLoading}
        onFocus={onFocus}
      >
        <BookPanel flashId={flashId} rows={bookRows} />
      </Panel>
      <Panel
        title="holders"
        sub={holdersSub}
        panelKey="holders"
        focused={focusedPanel === 'holders'}
        errored={errorPanel === 'holders'}
        loading={holdersLoading}
        onFocus={onFocus}
      >
        <HoldersPanel flashId={flashId} rows={holderRows} />
      </Panel>
      <Panel
        title="news"
        sub={newsSub}
        panelKey="news"
        focused={focusedPanel === 'news'}
        errored={errorPanel === 'news'}
        loading={newsLoading}
        onFocus={onFocus}
      >
        <NewsPanel
          flashId={flashId}
          catalysts={catalysts}
          sentiment={sentiment}
          resolution={resolution}
        />
      </Panel>
      <Panel
        title="thesis"
        sub={thesisSub}
        panelKey="thesis"
        focused={focusedPanel === 'thesis'}
        errored={errorPanel === 'thesis'}
        loading={thesisLoading}
        onFocus={onFocus}
      >
        <ThesisPanel onFlash={onFlash} thesis={thesis} />
      </Panel>
    </div>
  );
}
