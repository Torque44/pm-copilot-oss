// polymarketComments.ts — second backend in the news chain. Scrapes the
// public Polymarket comments endpoint for a given event slug, extracts URLs
// from comment bodies, and returns them as NewsHits.
//
// QUALITY CAVEAT: comment content is user-contributed. The chain marks
// these hits as `unverified` at filter time (off-allowlist domains get the
// flag regardless of source). Users see a small badge in the UI.
//
// The exact API URL is best-effort. Polymarket exposes comments per event
// through their public web app; we use the format `/api/comments?event_slug=`
// observed via network inspection. If their endpoint format changes or goes
// auth-walled, this backend silently returns [] and the chain escalates to
// the next backend — graceful degradation, no breakage.

import type { SearchBackend, NewsHit, SearchOpts } from '../types';

const URL_REGEX = /https?:\/\/[^\s<>"']+/g;
const COMMENTS_ENDPOINT = 'https://polymarket.com/api/comments';

type CommentPayload = {
  comments?: Array<{
    body?: string;
    text?: string;
    createdAt?: string;
  }>;
};

export type PolymarketCommentsOpts = {
  /** Resolves a market title (or query) to the corresponding event slug.
   *  The chain wires this — typically from the MarketMeta the supervisor
   *  already has. Returns null when we don't know the slug (e.g., search
   *  bar query without a market context). */
  slugFor: (query: string, marketTitle: string) => string | null;
};

export function makePolymarketCommentsBackend(opts: PolymarketCommentsOpts): SearchBackend {
  return {
    name: 'polymarket-comments',
    available: () => true,
    async search(query: string, sopts: SearchOpts): Promise<NewsHit[]> {
      const slug = opts.slugFor(query, sopts.marketTitle);
      if (!slug) return [];

      // Hard timeout — polymarket's public API can stall (TCP accept but no
      // body) and without an AbortController this fetch never resolves, which
      // pins the whole news chain. 8s aligns with the chain's per-backend
      // budget so we escalate cleanly rather than starve other backends.
      const ctrl = new AbortController();
      const killer = setTimeout(() => ctrl.abort(), 8_000);

      let payload: CommentPayload;
      try {
        const url = `${COMMENTS_ENDPOINT}?event_slug=${encodeURIComponent(slug)}&limit=50`;
        const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
        if (!res.ok) {
          clearTimeout(killer);
          return [];
        }
        payload = await res.json() as CommentPayload;
        clearTimeout(killer);
      } catch {
        clearTimeout(killer);
        return [];
      }

      const seen = new Set<string>();
      const hits: NewsHit[] = [];
      for (const c of payload.comments ?? []) {
        const body = c.body || c.text || '';
        const urls = body.match(URL_REGEX) ?? [];
        for (const u of urls) {
          if (seen.has(u)) continue;
          seen.add(u);
          let domain = '';
          try { domain = new URL(u).hostname.replace(/^www\./, ''); } catch { continue; }
          hits.push({
            url: u,
            title: trimAroundUrl(body, u),
            source: domain,
            publishedAt: c.createdAt ?? '',
            snippet: body.slice(0, 240),
          });
        }
      }
      return hits.filter((h) => Boolean(h.publishedAt));
    },
  };
}

function trimAroundUrl(body: string, url: string): string {
  // The comment body around the URL becomes the hit's "title" — better
  // than no title. Take the surrounding 80 chars, strip the URL itself.
  const idx = body.indexOf(url);
  if (idx < 0) return body.slice(0, 80);
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + url.length + 40);
  return body.slice(start, end).replace(url, '').replace(/\s+/g, ' ').trim().slice(0, 80) || body.slice(0, 80);
}
