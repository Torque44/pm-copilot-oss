// Panel — single grid cell. Shows loading skeleton, error state, or children.

import type { ReactNode } from 'react';

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
  errored,
  loading,
  onFocus,
  onRetry,
  onSwitchProvider,
  errorMessage,
  children,
}: PanelProps) {
  const activate = () => onFocus(panelKey);
  return (
    <section
      className={`panel ${focused ? 'focused' : ''} ${errored ? 'errored' : ''}`}
      onClick={activate}
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      aria-label={`${title} panel (${PANEL_KBD[panelKey]} to focus)`}
      onKeyDown={(e) => {
        // Enter / Space activate, matching the click handler. Don't swallow
        // other keys — global ⌘1/⌘2 shortcuts still need to bubble.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
    >
      <header className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="panel-sub mono">{sub}</span>
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
