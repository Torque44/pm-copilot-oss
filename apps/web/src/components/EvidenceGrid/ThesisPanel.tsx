// ThesisPanel — two tabs: "thesis" (claim tree) and "comparables" (resolved
// markets with similar shape so the trader gets a base-rate anchor).

import { useState } from 'react';
import { CitationPill } from './CitationPill';
import type { ComparableHit, Thesis } from '../../types';

type Tab = 'thesis' | 'comparables';

export interface ThesisPanelProps {
  onFlash: (id: string) => void;
  thesis?: Thesis;
  comparables?: ComparableHit[];
  baseRate?: { yesCount: number; resolvedCount: number; totalCount: number } | null;
}

export function ThesisPanel({ onFlash, thesis, comparables, baseRate }: ThesisPanelProps) {
  const [tab, setTab] = useState<Tab>('thesis');
  const haveThesis = !!thesis;
  const haveComps = (comparables?.length ?? 0) > 0;

  return (
    <div className="thesis-tabs-wrap">
      <div className="news-tabs">
        <button
          className={`news-tab ${tab === 'thesis' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setTab('thesis'); }}
        >
          thesis
        </button>
        <button
          className={`news-tab ${tab === 'comparables' ? 'active' : ''} ${haveComps ? '' : 'disabled'}`}
          onClick={(e) => { e.stopPropagation(); setTab('comparables'); }}
        >
          comparables{haveComps ? ` (${comparables!.length})` : ''}
        </button>
      </div>

      {tab === 'thesis' && !haveThesis && (
        <div className="panel-placeholder mono">no thesis derived</div>
      )}
      {tab === 'thesis' && haveThesis && (
        <ul className="thesis-tree">
          <li className="thesis-node">
            <span className="thesis-label">{thesis!.rootLabel}</span>
            <ul>
              {thesis!.nodes.map((n, i) => {
                const tagClass = n.kind === 'supports' ? 'yes' : 'no';
                const dirClass = n.kind === 'supports' ? 'up' : 'down';
                const tagLabel = n.kind === 'supports' ? 'SUPPORTS' : 'CHALLENGES';
                return (
                  <li key={i} className={`thesis-node ${dirClass}`}>
                    <span className={`thesis-tag mono ${tagClass}`}>{tagLabel}</span>
                    <span className="thesis-label">
                      {n.label}{' '}
                      {n.citationId && <CitationPill id={n.citationId} onFlash={onFlash} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        </ul>
      )}

      {tab === 'comparables' && !haveComps && (
        <div className="panel-placeholder mono">no comparable markets surfaced</div>
      )}
      {tab === 'comparables' && haveComps && (
        <div className="comparables-list">
          {baseRate && baseRate.resolvedCount > 0 && (
            <div className="comparables-baserate mono">
              base rate: {baseRate.yesCount}/{baseRate.resolvedCount} resolved YES
              ({Math.round((baseRate.yesCount / baseRate.resolvedCount) * 100)}%)
            </div>
          )}
          {comparables!.map((c, i) => {
            const verdict =
              c.outcome === 'yes' ? 'resolved YES' :
              c.outcome === 'no' ? 'resolved NO' :
              c.resolvedPrice != null ? `unresolved · YES @ ${(c.resolvedPrice * 100).toFixed(0)}%` :
              'unresolved';
            const verdictClass =
              c.outcome === 'yes' ? 'yes' :
              c.outcome === 'no' ? 'no' :
              'muted';
            const url = c.slug ? `https://polymarket.com/event/${c.slug}` : null;
            return (
              <div key={c.eventId} className="comparable-row" id={`src-comp·${i + 1}`}>
                <span className="cite-id mono">[comp·{i + 1}]</span>
                {url ? (
                  <a className="comparable-title news-link" href={url} target="_blank" rel="noopener noreferrer">
                    {c.title}
                  </a>
                ) : (
                  <span className="comparable-title">{c.title}</span>
                )}
                <span className={`comparable-verdict mono ${verdictClass}`}>{verdict}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
