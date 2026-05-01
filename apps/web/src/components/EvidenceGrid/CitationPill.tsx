// CitationPill — clickable inline `[c-XXX]` reference that flashes the matching source row.
//
// The internal id stays the wire format (`kol·N`, `news·N`) so it routes to the
// right citation row. The visible label hides the `kol·` prefix because the user
// asked us not to surface the word "kol" in the UI — sentiment citations just
// show as a number, news citations stay as `news·N` for distinction.

import type { MouseEvent } from 'react';

export interface CitationPillProps {
  id: string;
  onFlash: (id: string) => void;
}

function displayLabel(id: string): string {
  if (id.startsWith('kol·')) return id.slice('kol·'.length);
  return id;
}

export function CitationPill({ id, onFlash }: CitationPillProps) {
  const handleClick = (e: MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    onFlash(id);
  };
  return (
    <span className="cite-pill mono" onClick={handleClick}>
      [{displayLabel(id)}]
    </span>
  );
}
