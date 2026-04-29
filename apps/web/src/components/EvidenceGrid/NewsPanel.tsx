// NewsPanel — three tabs: catalysts | sentiment | resolution.

import { useState } from 'react';
import type { NewsItem, KOLSentimentItem } from '../../types';

type Tab = 'catalysts' | 'sentiment' | 'resolution';

const DEFAULT_CATALYSTS: NewsItem[] = [
  { id: 'c-022', title: 'btc consolidates near $96k as etf flows turn flat', src: 'reuters.com', when: '3h ago' },
  { id: 'c-023', title: 'fed minutes show divided committee on cut timing', src: 'wsj.com', when: '6h ago' },
  { id: 'c-024', title: 'mt gox creditor distribution paused — bitstamp ack', src: 'theblock.co', when: '14h ago' },
  { id: 'c-025', title: 'spot etf cumulative net inflows breach $42b mark', src: 'bloomberg.com', when: '1d ago' },
  { id: 'c-026', title: 'binance lists btc-quanto perp w/ 1d settle', src: 'binance.com', when: '2d ago' },
];

export interface NewsPanelProps {
  flashId: string | null;
  catalysts?: NewsItem[];
  sentiment: KOLSentimentItem[] | null;
  resolution: string;
}

export function NewsPanel({ flashId, catalysts, sentiment, resolution }: NewsPanelProps) {
  const [tab, setTab] = useState<Tab>('catalysts');
  const items = catalysts && catalysts.length > 0 ? catalysts : DEFAULT_CATALYSTS;

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

      {tab === 'catalysts' && (
        <ul className="news-list">
          {items.map((n) => (
            <li
              key={n.id}
              id={`src-${n.id}`}
              className={`news-row ${flashId === n.id ? 'flash' : ''}`}
            >
              <span className="cite-id mono">[{n.id}]</span>
              <span className="news-title">{n.title}</span>
              <span className="news-meta mono">
                {n.src} · {n.when}
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

      {tab === 'resolution' && <div className="resolution-criteria">{resolution}</div>}
    </div>
  );
}
