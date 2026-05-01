// MarketPanel — left workbench panel: book / holders / outcomes (when
// multi-outcome) as internal tabs.
//
// The outcomes tab only appears for events that have >1 sibling outcome —
// e.g. "who wins 2024 election" with N candidates. Clicking a candidate
// navigates to that outcome's market so the brief reloads against it. For
// binary markets the tab is hidden so the panel stays clean.

import { useState } from 'react';
import { BookPanel } from './BookPanel';
import { HoldersPanel } from './HoldersPanel';
import type { BookRow, EventOutcome, HolderRow } from '../../types';

type Tab = 'book' | 'holders' | 'outcomes';

export interface MarketPanelProps {
  flashId: string | null;
  bookRows?: BookRow[];
  holderRows?: HolderRow[];
  /** Sibling outcomes (multi-outcome events). When length > 1, renders the
   *  outcomes tab. */
  outcomes?: EventOutcome[];
  /** Currently-loaded outcome marketId — highlighted in the outcomes list. */
  selectedOutcomeId?: string | null;
  onOutcomeSelect?: (marketId: string) => void;
}

export function MarketPanel({
  flashId,
  bookRows,
  holderRows,
  outcomes,
  selectedOutcomeId,
  onOutcomeSelect,
}: MarketPanelProps) {
  const [tab, setTab] = useState<Tab>('book');
  const hasOutcomes = (outcomes?.length ?? 0) > 1;

  return (
    <div className="news-tabs-wrap">
      <div className="news-tabs">
        <button
          className={`news-tab ${tab === 'book' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setTab('book'); }}
        >
          book{bookRows?.length ? ` (${bookRows.length})` : ''}
        </button>
        <button
          className={`news-tab ${tab === 'holders' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setTab('holders'); }}
        >
          holders{holderRows?.length ? ` (${holderRows.length})` : ''}
        </button>
        {hasOutcomes && (
          <button
            className={`news-tab ${tab === 'outcomes' ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setTab('outcomes'); }}
          >
            outcomes ({outcomes!.length})
          </button>
        )}
      </div>

      {tab === 'book' && <BookPanel flashId={flashId} rows={bookRows} />}
      {tab === 'holders' && <HoldersPanel flashId={flashId} rows={holderRows} />}
      {tab === 'outcomes' && hasOutcomes && (
        <div className="outcomes-list">
          {outcomes!.map((o) => {
            const isSelected = o.id === selectedOutcomeId;
            const pct = Math.round(o.price * 100);
            return (
              <button
                key={o.id}
                type="button"
                className={`outcome-card ${isSelected ? 'selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isSelected) onOutcomeSelect?.(o.id);
                }}
                title={isSelected ? 'currently loaded' : 'switch brief to this outcome'}
              >
                <span className="outcome-card-name">{o.name}</span>
                <span className="outcome-card-bar">
                  <span
                    className="outcome-card-bar-fill"
                    style={{ width: `${Math.max(2, Math.min(98, pct))}%` }}
                  />
                </span>
                <span className="outcome-card-pct mono">{pct}%</span>
                {isSelected && <span className="outcome-card-badge mono">loaded</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
