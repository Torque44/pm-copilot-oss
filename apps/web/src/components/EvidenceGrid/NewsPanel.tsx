// NewsPanel — three tabs: catalysts | sentiment | resolution.

import { useState } from 'react';
import type { NewsItem, KOLSentimentItem } from '../../types';

type Tab = 'catalysts' | 'sentiment' | 'resolution';

export interface NewsPanelProps {
  flashId: string | null;
  catalysts?: NewsItem[];
  sentiment: KOLSentimentItem[] | null;
  resolution: string;
}

export function NewsPanel({ flashId, catalysts, sentiment, resolution }: NewsPanelProps) {
  const [tab, setTab] = useState<Tab>('catalysts');
  const items = catalysts ?? [];

  return (
    <div className="news-tabs-wrap">
      <div className="news-tabs">
        <button
          className={`news-tab ${tab === 'catalysts' ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setTab('catalysts');
          }}
        >
          catalysts
        </button>
        <button
          className={`news-tab ${tab === 'sentiment' ? 'active' : ''} ${sentiment === null ? 'disabled' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setTab('sentiment');
          }}
        >
          sentiment
        </button>
        <button
          className={`news-tab ${tab === 'resolution' ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setTab('resolution');
          }}
        >
          resolution
        </button>
      </div>

      {tab === 'catalysts' && items.length === 0 && (
        <div className="panel-placeholder mono">no catalysts surfaced</div>
      )}
      {tab === 'catalysts' && items.length > 0 && (
        <ul className="news-list">
          {items.map((n) => (
            <li
              key={n.id}
              id={`src-${n.id}`}
              className={`news-row ${flashId === n.id ? 'flash' : ''}`}
            >
              <span className="cite-id mono">[{n.id}]</span>
              {n.url ? (
                <a
                  className="news-title news-link"
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {n.title}
                </a>
              ) : (
                <span className="news-title">{n.title}</span>
              )}
              <span className="news-meta mono">
                {n.src}
                {n.when ? ` · ${n.when}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === 'sentiment' && sentiment === null && (
        <div className="sentiment-disabled mono">
          configure xAI key in setup to enable sentiment
        </div>
      )}

      {tab === 'sentiment' && sentiment !== null && (
        <ul className="sentiment-list">
          {sentiment.map((s) => (
            <li
              key={s.id}
              id={`src-${s.id}`}
              className={`sentiment-row ${flashId === s.id ? 'flash' : ''}`}
            >
              <span className="cite-id mono">[kol·{s.id.replace(/^c-?/, '')}]</span>
              <span className="sentiment-kol">
                <span className="sentiment-name">{s.kol}</span>
                <span className="mono muted">@{s.handle}</span>
              </span>
              <span className="sentiment-excerpt">{s.excerpt}</span>
              <span className="sentiment-meta mono">
                {s.when} · rel {s.relevance.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === 'resolution' && (
        <div className="resolution-criteria">
          {resolution || <span className="mono muted">no resolution copy on this market</span>}
        </div>
      )}
    </div>
  );
}
