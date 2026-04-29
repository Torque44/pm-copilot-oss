// CitationPill — clickable inline `[c-XXX]` reference that flashes the matching source row.

import type { MouseEvent } from 'react';

export interface CitationPillProps {
  id: string;
  onFlash: (id: string) => void;
}

export function CitationPill({ id, onFlash }: CitationPillProps) {
  const handleClick = (e: MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    onFlash(id);
  };
  return (
    <span className="cite-pill mono" onClick={handleClick}>
      [{id}]
    </span>
  );
}
