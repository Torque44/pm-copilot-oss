// NewsPanel — five tabs: catalysts | sentiment | thesis | comparables | resolution.
//
// Used to be three (news only) plus a separate ThesisPanel cell. The user
// asked for thesis to live inside the news panel so the "narrative" stuff
// is one box and the "structural data" (book + holders) is the other.

import { useState } from 'react';
import { CitationPill } from './CitationPill';
import { isSafeHref } from '../../lib/url';
import type {
  ComparableHit,
  KOLSentimentItem,
  NewsItem,
  Thesis,
} from '../../types';

type Tab = 'catalysts' | 'sentiment' | 'thesis' | 'comparables' | 'resolution';

export interface NewsPanelProps {
  flashId: string | null;
  catalysts?: NewsItem[];
  sentiment: KOLSentimentItem[] | null;
  resolution: string;
  thesis?: Thesis;
  comparables?: ComparableHit[];
  baseRate?: { yesCount: number; resolvedCount: number; totalCount: number } | null;
  /** Citation flash dispatcher — wired from EvidenceGrid. */
  onFlash?: (id: string) => void;
  /** Per-source running flags so each tab can render its own loading
   *  skeleton instead of "no X surfaced" while the agent is still in flight. */
  newsRunning?: boolean;
  sentimentRunning?: boolean;
  thesisRunning?: boolean;
  comparablesRunning?: boolean;
}

export function NewsPanel({
  flashId,
  catalysts,
  sentiment,
  resolution,
  thesis,
  comparables,
  baseRate,
  onFlash,
  newsRunning = false,
  sentimentRunning = false,
  thesisRunning = false,
  comparablesRunning = false,
}: NewsPanelProps) {
  const [tab, setTab] = useState<Tab>('catalysts');
  const items = catalysts ?? [];
  const haveThesis = !!thesis;
  const haveComps = (comparables?.length ?? 0) > 0;

  const flash = onFlash ?? (() => {});

  return (
    <div className="news-tabs-wrap">
      <div className="news-tabs">
        <button
          className={`news-tab ${tab === 'catalysts' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setTab('catalysts'); }}
        >
          catalysts{items.length ? ` (${items.length})` : ''}
        </button>
        <button
          className={`news-tab ${tab === 'sentiment' ? 'active' : ''} ${sentiment === null ? 'disabled' : ''}`}
          onClick={(e) => { e.stopPropagation(); setTab('sentiment'); }}
        >
          sentiment
        </button>
        <button
          className={`news-tab ${tab === 'thesis' ? 'active' : ''} ${haveThesis ? '' : 'disabled'}`}
          onClick={(e) => { e.stopPropagation(); setTab('thesis'); }}
        >
          thesis{haveThesis ? ` (${thesis!.nodes.length})` : ''}
        </button>
        <button
          className={`news-tab ${tab === 'comparables' ? 'active' : ''} ${haveComps ? '' : 'disabled'}`}
          onClick={(e) => { e.stopPropagation(); setTab('comparables'); }}
        >
          comparables{haveComps ? ` (${comparables!.length})` : ''}
        </button>
        <button
          className={`news-tab ${tab === 'resolution' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setTab('resolution'); }}
        >
          resolution
        </button>
      </div>

      {tab === 'catalysts' && items.length === 0 && newsRunning && (
        <div className="panel-skel">
          <div className="panel-skel-row" />
          <div className="panel-skel-row" />
          <div className="panel-skel-row" />
          <div className="panel-skel-hint mono">scanning curated sources…</div>
        </div>
      )}
      {tab === 'catalysts' && items.length === 0 && !newsRunning && (
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
              {(() => {
                const safe = isSafeHref(n.url);
                return safe ? (
                  <a
                    className="news-title news-link"
                    href={safe}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {n.title}
                  </a>
                ) : (
                  <span className="news-title">{n.title}</span>
                );
              })()}
              <span className="news-meta mono">
                {n.src}
                {n.when ? ` · ${n.when}` : ''}
                {n.unverified && (
                  n.src === 'model knowledge' ? (
                    <span
                      className="news-unverified mono"
                      title="No live news source returned for this market. This row is model knowledge only — click to search the web for the headline yourself."
                    >
                      {' '}· training fallback
                    </span>
                  ) : (
                    <span
                      className="news-unverified mono"
                      title="source not on the curated allowlist for this category — apply your own discount"
                    >
                      {' '}· unverified
                    </span>
                  )
                )}
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

      {tab === 'sentiment' && sentiment !== null && sentiment.length === 0 && sentimentRunning && (
        <div className="panel-skel">
          <div className="panel-skel-row" />
          <div className="panel-skel-row" />
          <div className="panel-skel-hint mono">querying vetted handles via xAI live search…</div>
        </div>
      )}
      {tab === 'sentiment' && sentiment !== null && sentiment.length === 0 && !sentimentRunning && (
        <div className="panel-placeholder mono">
          no recent posts from vetted handles for this market.
          <br />
          handle allowlists are curated per category (politics, macro, crypto,
          sports, tech, culture). niche topics or new artists may not be covered yet.
        </div>
      )}
      {tab === 'sentiment' && sentiment !== null && sentiment.length > 0 && (
        <ul className="sentiment-list">
          {sentiment.map((s) => {
            const handle = s.handle?.replace(/^@/, '') || '';
            const tweetUrl = isSafeHref(s.url) || (handle ? `https://x.com/${handle}` : '');
            return (
              <li
                key={s.id}
                id={`src-${s.id}`}
                className={`sentiment-row ${flashId === s.id ? 'flash' : ''}`}
              >
                {handle && (
                  tweetUrl ? (
                    <a
                      className="sentiment-handle mono news-link"
                      href={tweetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      @{handle}
                    </a>
                  ) : (
                    <span className="sentiment-handle mono">@{handle}</span>
                  )
                )}
                {s.excerpt
                  ? <span className="sentiment-excerpt">{s.excerpt}</span>
                  : <span className="sentiment-excerpt mono muted">(no excerpt)</span>}
                {s.when && <span className="sentiment-meta mono">{s.when}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'thesis' && !haveThesis && thesisRunning && (
        <div className="panel-skel">
          <div className="panel-skel-row" />
          <div className="panel-skel-row" />
          <div className="panel-skel-row" />
          <div className="panel-skel-hint mono">building causal claim tree…</div>
        </div>
      )}
      {tab === 'thesis' && !haveThesis && !thesisRunning && (
        <div className="panel-placeholder mono">no thesis derived</div>
      )}
      {tab === 'thesis' && haveThesis && (
        <ul className="thesis-tree">
          <li className="thesis-node">
            <span className="thesis-label">{thesis!.rootLabel}</span>
            <ul>
              {thesis!.nodes.map((n, i) => {
                const tagClass = n.kind === 'supports' ? 'yes' : 'no';
                const dirClass = n.kind === 'supports' ? 'up' : 'down';
                const tagLabel = n.kind === 'supports' ? 'SUPPORTS' : 'CHALLENGES';
                return (
                  <li key={i} className={`thesis-node ${dirClass}`}>
                    <span className={`thesis-tag mono ${tagClass}`}>{tagLabel}</span>
                    <span className="thesis-label">
                      {n.label}{' '}
                      {n.citationId && <CitationPill id={n.citationId} onFlash={flash} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        </ul>
      )}

      {tab === 'comparables' && !haveComps && comparablesRunning && (
        <div className="panel-skel">
          <div className="panel-skel-row" />
          <div className="panel-skel-row" />
          <div className="panel-skel-hint mono">searching resolved markets with similar shape…</div>
        </div>
      )}
      {tab === 'comparables' && !haveComps && !comparablesRunning && (
        <div className="panel-placeholder mono">no comparable markets surfaced</div>
      )}
      {tab === 'comparables' && haveComps && (
        <div className="comparables-list">
          {baseRate && baseRate.resolvedCount >= 3 && (
            <div className="comparables-baserate mono">
              base rate: {baseRate.yesCount}/{baseRate.resolvedCount} resolved YES
              ({Math.round((baseRate.yesCount / baseRate.resolvedCount) * 100)}%)
            </div>
          )}
          {baseRate && baseRate.resolvedCount > 0 && baseRate.resolvedCount < 3 && (
            <div className="comparables-baserate mono muted">
              n={baseRate.resolvedCount} resolved · sample too small for a base rate
            </div>
          )}
          {comparables!.map((c, i) => {
            const verdict =
              c.outcome === 'yes' ? 'resolved YES' :
              c.outcome === 'no' ? 'resolved NO' :
              c.resolvedPrice != null ? `unresolved · YES @ ${(c.resolvedPrice * 100).toFixed(0)}%` :
              'unresolved';
            const verdictClass =
              c.outcome === 'yes' ? 'yes' :
              c.outcome === 'no' ? 'no' :
              'muted';
            const url = c.slug ? isSafeHref(`https://polymarket.com/event/${c.slug}`) : null;
            return (
              <div key={c.eventId} className="comparable-row" id={`src-comp·${i + 1}`}>
                <span className="cite-id mono">[comp·{i + 1}]</span>
                {url ? (
                  <a className="comparable-title news-link" href={url} target="_blank" rel="noopener noreferrer">
                    {c.title}
                  </a>
                ) : (
                  <span className="comparable-title">{c.title}</span>
                )}
                <span className={`comparable-verdict mono ${verdictClass}`}>{verdict}</span>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'resolution' && (
        <div className="resolution-criteria">
          {resolution || <span className="mono muted">no resolution copy on this market</span>}
        </div>
      )}
    </div>
  );
}
