// Panel — single grid cell. Shows loading skeleton, error state, or children.

import type { ReactNode } from 'react';

export type PanelKey = 'book' | 'holders' | 'news' | 'thesis';

const PANEL_KBD: Record<PanelKey, string> = {
  book: '⌘1',
  holders: '⌘2',
  news: '⌘3',
  thesis: '⌘4',
};

export interface PanelProps {
  title: string;
  sub: string;
  panelKey: PanelKey;
  focused: boolean;
  errored: boolean;
  loading: boolean;
  onFocus: (key: PanelKey) => void;
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
  children,
}: PanelProps) {
  return (
    <section
      className={`panel ${focused ? 'focused' : ''} ${errored ? 'errored' : ''}`}
      onClick={() => onFocus(panelKey)}
    >
      <header className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="panel-sub mono">{sub}</span>
        <span className="panel-kbd mono">{PANEL_KBD[panelKey]}</span>
      </header>
      <div className="panel-body">
        {errored ? (
          <div className="panel-error">
            <div className="panel-error-head">polymarket gamma-api timeout</div>
            <div className="panel-error-body">
              no response in 8000ms. <a className="link">retry</a> ·{' '}
              <a className="link">switch provider</a>
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
