// VerdictBand — bottom strip summarising the desk verdict + key stats.

import type { VerdictSection } from '../../types';

const DEFAULT_SECTIONS: VerdictSection[] = [
  { label: 'implied yield', value: '+4.8%' },
  { label: 'days to resolve', value: '14d 6h' },
  { label: 'book depth (yes)', value: '$184k @ 0.62' },
  { label: 'spread', value: '0.03' },
  { label: 'holders concentration', value: '47.3% top10' },
];

export interface VerdictBandProps {
  sections?: VerdictSection[];
  citationCount?: number;
  verdict?: string;
}

export function VerdictBand({
  sections,
  citationCount,
  verdict = 'signals split',
}: VerdictBandProps) {
  const data = sections && sections.length > 0 ? sections : DEFAULT_SECTIONS;
  return (
    <div className="verdict-band">
      <div className="verdict-text">{verdict}</div>
      <div className="verdict-sep" />
      {data.map((s, i) => (
        <div key={i} className="verdict-stat">
          <div className="verdict-label mono">{s.label}</div>
          <div className="verdict-value mono">{s.value}</div>
        </div>
      ))}
      {citationCount !== undefined && (
        <div className="verdict-stat">
          <div className="verdict-label mono">citations</div>
          <div className="verdict-value mono">{citationCount}</div>
        </div>
      )}
    </div>
  );
}
