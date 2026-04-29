// CommandPalette — ⌘K. Scrim + input + command list. Each item runs a
// callback supplied by App.tsx so the palette stays a thin shell.

import { useMemo, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from 'react';

export type CommandItem = {
  id: string;
  label: string;
  kbd?: string;
  run: () => void;
};

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.label.toLowerCase().includes(q));
  }, [items, query]);

  if (!open) return null;
  const stop = (e: MouseEvent<HTMLDivElement>) => e.stopPropagation();

  const fire = (cmd: CommandItem) => {
    cmd.run();
    setQuery('');
    onClose();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const top = filtered[0];
      if (top) fire(top);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="palette" onClick={stop}>
        <input
          className="palette-input"
          placeholder="run command, search market, or paste url"
          autoFocus
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="palette-list">
          {filtered.length === 0 && (
            <div className="palette-item palette-empty mono">no matches</div>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              className="palette-item"
              onClick={() => fire(c)}
            >
              <span className="palette-label">{c.label}</span>
              {c.kbd && <span className="palette-kbd mono">{c.kbd}</span>}
            </button>
          ))}
        </div>
        <div className="palette-foot mono">esc to close · ↵ to run</div>
      </div>
    </div>
  );
}
