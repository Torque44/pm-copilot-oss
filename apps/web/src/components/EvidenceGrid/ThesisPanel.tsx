// ThesisPanel — claim tree with supports/challenges leaves.

import { CitationPill } from './CitationPill';
import type { Thesis } from '../../types';

const DEFAULT_THESIS: Thesis = {
  rootLabel: 'btc reaches $100k by eoy 2026',
  nodes: [
    { kind: 'supports', label: 'spot etf flows positive ttm', citationId: 'c-025' },
    { kind: 'supports', label: 'top 10 holders concentrated 47% yes', citationId: 'c-014' },
    { kind: 'challenges', label: 'consolidation near $96k for 4w', citationId: 'c-022' },
    { kind: 'challenges', label: 'book thin above 0.65', citationId: 'c-005' },
  ],
};

export interface ThesisPanelProps {
  onFlash: (id: string) => void;
  thesis?: Thesis;
}

export function ThesisPanel({ onFlash, thesis }: ThesisPanelProps) {
  const t = thesis ?? DEFAULT_THESIS;
  return (
    <ul className="thesis-tree">
      <li className="thesis-node">
        <span className="thesis-label">{t.rootLabel}</span>
        <ul>
          {t.nodes.map((n, i) => {
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
  );
}
