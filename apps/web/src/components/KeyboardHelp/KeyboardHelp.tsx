// KeyboardHelp — modal cheat sheet of all keyboard shortcuts. Toggled by
// pressing `?` when no input is focused. Renders nothing until opened to
// keep the always-mounted footprint zero.
//
// Why a modal and not a sidebar tooltip: shortcuts are a power-user feature
// users discover when they want to go faster. A modal is the "I want to see
// everything at once" interaction, which beats hover-tooltips on individual
// controls (which require knowing which control to hover first).

import { useEffect } from 'react';

export interface KeyboardHelpProps {
  open: boolean;
  onClose: () => void;
}

type ShortcutGroup = {
  title: string;
  items: Array<{ keys: string; label: string }>;
};

const GROUPS: ShortcutGroup[] = [
  {
    title: 'navigation',
    items: [
      { keys: '⌘K', label: 'open command palette' },
      { keys: '⌘1', label: 'focus market panel (book + holders)' },
      { keys: '⌘2', label: 'focus research panel (news + sentiment + thesis + comparables)' },
      { keys: '⌘[', label: 'toggle left rail (events list)' },
      { keys: '⌘]', label: 'toggle right rail (agent pipeline)' },
      { keys: 'esc', label: 'close palette / modal / setup' },
    ],
  },
  {
    title: 'market actions',
    items: [
      { keys: '⌘B', label: 'add or remove current market from watchlist' },
      { keys: '?', label: 'open this help' },
    ],
  },
  {
    title: 'chat',
    items: [
      { keys: 'enter', label: 'send question to chat' },
      { keys: 'shift+enter', label: '(reserved — multi-line in future)' },
    ],
  },
];

export function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="kbd-help-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="keyboard shortcuts">
      <div className="kbd-help-card" onClick={(e) => e.stopPropagation()}>
        <header className="kbd-help-head">
          <h2 className="kbd-help-title">keyboard shortcuts</h2>
          <button
            type="button"
            className="kbd-help-close"
            onClick={onClose}
            aria-label="close"
            title="close (esc)"
          >
            ×
          </button>
        </header>
        <div className="kbd-help-grid">
          {GROUPS.map((g) => (
            <section key={g.title} className="kbd-help-group">
              <h3 className="kbd-help-group-title mono">{g.title}</h3>
              <ul className="kbd-help-list">
                {g.items.map((it) => (
                  <li key={it.keys} className="kbd-help-row">
                    <kbd className="kbd-help-key mono">{it.keys}</kbd>
                    <span className="kbd-help-label">{it.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="kbd-help-foot mono">
          press <kbd className="kbd-help-key inline">?</kbd> any time to reopen
        </footer>
      </div>
    </div>
  );
}
