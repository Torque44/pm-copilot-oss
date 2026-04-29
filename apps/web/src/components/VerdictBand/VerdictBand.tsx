// VerdictBand — bottom strip summarising the desk verdict + key stats.

import type { VerdictSection } from '../../types';

export interface VerdictBandProps {
  sections?: VerdictSection[];
  citationCount?: number;
  verdict?: string;
}

export function VerdictBand({
  sections,
  citationCount,
  verdict,
}: VerdictBandProps) {
  const data = sections ?? [];
  // Verdict text defaults from the section count: while the brief is still
  // streaming and we have nothing to surface, show "synthesizing…" rather
  // than the misleading "signals split" baked-in copy.
  const text = verdict || (data.length === 0 ? 'synthesizing…' : 'evidence summary');
  return (
    <div className="verdict-band">
      <div className="verdict-text">{text}</div>
      <div className="verdict-sep" />
      {data.map((s, i) => (
        <div key={i} className="verdict-stat">
          <div className="verdict-label mono">{s.label}</div>
          <div className="verdict-value mono">{s.value}</div>
        </div>
      ))}
      {citationCount !== undefined && citationCount > 0 && (
        <div className="verdict-stat">
          <div className="verdict-label mono">citations</div>
          <div className="verdict-value mono">{citationCount}</div>
        </div>
      )}
    </div>
  );
}
