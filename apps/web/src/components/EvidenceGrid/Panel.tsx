// Panel — single grid cell. Shows loading skeleton, error state, or children.

import type { ReactNode, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Two top-level panels now: 'market' (book + holders tabs) and 'research'
 * (catalysts + sentiment + thesis + comparables + resolution tabs). Internal
 * tab state is owned by the panel components themselves.
 *
 * Legacy keys ('book' | 'holders' | 'news' | 'thesis') are still accepted
 * for backwards compatibility — see App.tsx where they remap to the new
 * top-level keys.
 */
export type PanelKey = 'market' | 'research';

const PANEL_KBD: Record<PanelKey, string> = {
  market: '⌘1',
  research: '⌘2',
};

export interface PanelProps {
  title: string;
  sub: string;
  panelKey: PanelKey;
  focused: boolean;
  /** True when SOME panel is focused (so the un-focused sibling is hidden).
   *  Drives the "show both" button on the focused panel's header. */
  anyFocused?: boolean;
  errored: boolean;
  loading: boolean;
  onFocus: (key: PanelKey) => void;
  /** Optional retry handler shown in the error state. */
  onRetry?: () => void;
  /** Optional "switch provider" handler — opens the setup overlay. */
  onSwitchProvider?: () => void;
  /** Error copy override. Defaults to a generic gamma-api timeout line. */
  errorMessage?: string;
  children: ReactNode;
}

export function Panel({
  title,
  sub,
  panelKey,
  focused,
  anyFocused,
  errored,
  loading,
  onFocus,
  onRetry,
  onSwitchProvider,
  errorMessage,
  children,
}: PanelProps) {
  // Focus-toggle lives on the HEADER only — previously the whole <section>
  // had onClick, which meant any click inside the body (a news pill, a row
  // expander) bubbled up and collapsed the sibling panel. Users reported
  // confusion: clicking a news link made the market panel disappear with
  // no obvious way back. Keeping click semantics on the header makes the
  // affordance explicit and stops the body from triggering focus.
  const toggleFocus = (e: ReactMouseEvent | ReactKeyboardEvent) => {
    e.stopPropagation();
    // Clicking the focused panel's header un-focuses (returns to dual view).
    // Clicking an un-focused panel's header focuses it.
    onFocus(panelKey);
  };
  return (
    <section
      className={`panel ${focused ? 'focused' : ''} ${errored ? 'errored' : ''}`}
      aria-label={`${title} panel`}
    >
      <header
        className="panel-head clickable"
        role="button"
        tabIndex={0}
        aria-pressed={focused}
        aria-label={focused ? `${title} — click header to show both panels` : `${title} — click header to focus (${PANEL_KBD[panelKey]})`}
        onClick={toggleFocus}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleFocus(e);
          }
        }}
      >
        <span className="panel-title">{title}</span>
        <span className="panel-sub mono">{sub}</span>
        {focused && anyFocused && (
          <button
            type="button"
            className="panel-show-both mono"
            title="show both panels (esc)"
            aria-label="show both panels"
            onClick={(e) => { e.stopPropagation(); onFocus(panelKey); }}
          >
            ⇆ both
          </button>
        )}
        <span className="panel-kbd mono">{PANEL_KBD[panelKey]}</span>
      </header>
      <div className="panel-body">
        {errored ? (
          <div className="panel-error">
            <div className="panel-error-head">{errorMessage ?? 'data fetch failed'}</div>
            <div className="panel-error-body">
              {onRetry && (
                <button
                  type="button"
                  className="link link-btn"
                  onClick={(e) => { e.stopPropagation(); onRetry(); }}
                >
                  retry
                </button>
              )}
              {onRetry && onSwitchProvider && ' · '}
              {onSwitchProvider && (
                <button
                  type="button"
                  className="link link-btn"
                  onClick={(e) => { e.stopPropagation(); onSwitchProvider(); }}
                >
                  switch provider
                </button>
              )}
              {!onRetry && !onSwitchProvider && (
                <span className="mono muted">try refreshing the page</span>
              )}
            </div>
          </div>
        ) : loading ? (
          <div className="skeleton">
            <div className="skel-row" />
            <div className="skel-row" />
            <div className="skel-row" />
            <div className="skel-row" />
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
