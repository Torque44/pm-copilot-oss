// ThesisPanel — claim tree with supports/challenges leaves.

import { CitationPill } from './CitationPill';
import type { Thesis } from '../../types';

export interface ThesisPanelProps {
  onFlash: (id: string) => void;
  thesis?: Thesis;
}

export function ThesisPanel({ onFlash, thesis }: ThesisPanelProps) {
  if (!thesis) {
    return <div className="panel-placeholder mono">no thesis derived</div>;
  }
  const t = thesis;
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
