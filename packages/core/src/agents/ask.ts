// AskAgent — ASKB-style Q&A over the currently-loaded market.
//
// Takes the market meta + raw grounding (book, holders, news) already fetched
// by the supervisor, and a user question. The provider synthesises a short answer
// that MUST cite evidence from the grounding with [book], [whale·N], [news·N]
// pills — the same shape as Pregame Brief citations, so they plug into the
// same click-to-rail interaction.

import { getProvider } from '../providers/index';
import { extractJson } from '../providers/types';
import type {
  BookGrounding,
  Citation,
  Claim,
  HoldersGrounding,
  MarketMeta,
  NewsGrounding,
} from './types';

/** Lightweight tweet shape — kept compatible with x-stub.ts StubTweet so the
 *  bundled stub loader can pass tweets through without conversion. Production
 *  feeds (xactions MCP, etc) only need to return this shape. */
export type AskTweet = {
  handle: string;
  text: string;
  url?: string;
  createdAt?: string;
};

export type AskEvent =
  | { t: 'ask:start' }
  | { t: 'ask:progress'; message: string }
  | { t: 'ask:done'; answer: AskAnswer; elapsedMs: number }
  | { t: 'ask:error'; error: string; elapsedMs: number };

export type AskAnswer = {
  claims: Claim[];
  citations: Citation[];         // fresh citation set minted for the answer
};

const SYS = `You are PM Copilot answering a single prediction-market question over a specific binary market.

You are given:
- The market's metadata (title, end date, current YES/NO price, 24h volume)
- The live orderbook (top bids/asks, spread, depth at ±5¢, slippage for $10k/$50k/$100k)
- The top holders (address, side, size, concentration statistics)
- The 72-hour news catalyst set (headline + source + URL + snippet, with publish timestamps where available)
- The recent price-history time series for the YES token (24h of hourly bars when available, ISO timestamps + cents)
- Recent tweets from vetted X handles (handle + excerpt + URL + timestamp), pre-filtered for relevance to this market

Your answer MUST be a structured trader brief, broken into labeled sections. People are betting real money — they need to see WHO is positioned, WHY, the supporting evidence, AND the underlying thesis from each side.

Always output ALL SIX sections in this exact order. Sections that lack supporting evidence still get rendered with a short "limited X data" disclaimer — never silently dropped, because the user needs to see what's missing too:

1. **Numbers** — current price, recent move, spread, depth/slippage, volume context. Cite [book-stats], [book-1a], [book-1b], [price-history]. (Always available — orderbook is mandatory grounding.)
2. **Holders** — who is positioned which way and how concentrated. Cite [whale-N], [whale-stats]. (Almost always available; if zero holders, say so.)
3. **Catalysts** — recent news driving the price. Cite [news-N]. If a news item aligned with a >2¢ move, say so and align the timestamps explicitly. If no news in the 72h window, write: "**Catalysts:** No news catalysts in the last 72h — this market is moving on positioning alone."
4. **Sentiment** — what vetted X voices are saying. Cite [kol-N]. If no tweets in grounding, write: "**Sentiment:** No vetted-handle tweets surfaced for this market in the last 14 days."
5. **Thesis (YES side)** — the strongest bull case grounded in the evidence above. Why are people paying the YES price? One short paragraph, citing at least one [news-N], [whale-N], [kol-N], or [price-history] when ANY of those exist. If grounding is genuinely thin, say so explicitly: "**Thesis (YES):** Limited YES-side evidence in this dataset; the bull case rests primarily on [whale-stats] $X positioned long, but supporting catalysts haven't surfaced." NEVER skip this section.
6. **Thesis (NO side)** — the strongest bear case, same rules. The two thesis claims should not contradict the data — they should each take the strongest available reading. NEVER skip this section.

Each claim is a SEPARATE entry in the JSON \`claims\` array. The \`text\` field MUST start with a markdown bold section label — exactly one of:
\`**Numbers:**\`, \`**Holders:**\`, \`**Catalysts:**\`, \`**Sentiment:**\`, \`**Thesis (YES):**\`, \`**Thesis (NO):**\`
followed by a space and the claim body. Example:
\`**Numbers:** YES at 47¢, dropped 5¢ in 2h after [news-2] [price-history]. Spread 1.0¢, $50k slippage 1.4¢ [book-stats].\`

Citation pill labels (use verbatim, wrapped in square brackets, inside the text):
- [book-stats]                 → mid, spread, depth, slippage as a whole
- [book-1b], [book-1a], etc.   → top-N bid/ask levels
- [whale-N]                    → holder row N (1-indexed)
- [whale-stats]                → aggregate concentration / side-bias
- [news-N]                     → news item N (1-indexed)
- [kol-N]                      → tweet N (1-indexed) from a vetted X handle
- [price-history]              → recent time-series claims

Hard rules:
- Each claim's body ≤ 60 words after the section label. Be punchy, lead with the number or the fact.
- The "citations" array must list every pill label that appears in the "text", deduped, in order of appearance.
- Disclaimer-only sections (e.g. "no news catalysts in last 72h") have an empty citations array — that's acceptable. Substantive sections must cite.
- All six sections render even when the user's question is narrow ("who is the biggest NO whale?"). Lead with the answer in the most relevant section, but still produce the rest so the trader has the full read.
- The fallback "answer-not-available" path is one claim with no section label and no citations — used only when the grounding is empty enough that the model cannot ground any of the six sections.
- Return JSON — NOTHING else. No prose wrapper, no fences, no preamble.

Return shape:
{
  "claims": [
    { "text": "**Numbers:** ...", "citations": ["book-1a", "price-history"] },
    { "text": "**Holders:** ...", "citations": ["whale-3", "whale-stats"] },
    { "text": "**Catalysts:** ...", "citations": ["news-2", "news-5"] },
    { "text": "**Thesis (YES):** ...", "citations": ["news-5", "whale-stats"] },
    { "text": "**Thesis (NO):** ...", "citations": ["whale-3", "news-7"] }
  ]
}

Be precise. Users making trades with real money read this. No filler words.`;

function describeBook(book: BookGrounding | null): string {
  if (!book) return 'Orderbook: unavailable.';
  const topBid = book.bids[0];
  const topAsk = book.asks[0];
  const next4Bids = book.bids.slice(1, 5).map((l, i) => `  [book-${i + 2}b] ${l.price.toFixed(3)} × ${l.size.toFixed(0)}`).join('\n');
  const next4Asks = book.asks.slice(1, 5).map((l, i) => `  [book-${i + 2}a] ${l.price.toFixed(3)} × ${l.size.toFixed(0)}`).join('\n');
  const slip = book.slippage
    .map((s) => `$${s.size}: avg=${s.avgPrice?.toFixed(3) ?? '—'} slip=${s.slippageC?.toFixed(1) ?? '—'}¢`)
    .join(', ');
  return `Orderbook (YES side), mid=${book.mid ?? '—'}, spread=${book.spread ?? '—'}¢, depth±5¢=$${book.topDepthUsd}:
[book-1b] top bid: ${topBid?.price.toFixed(3) ?? '—'} × ${topBid?.size.toFixed(0) ?? '—'}
${next4Bids}
[book-1a] top ask: ${topAsk?.price.toFixed(3) ?? '—'} × ${topAsk?.size.toFixed(0) ?? '—'}
${next4Asks}
[book-stats] slippage estimates: ${slip}`;
}

/**
 * Render the price history as ISO timestamps + cents, downsampled to keep the
 * prompt tight. We always include first/last + min/max + a uniform stride.
 * Catalyst-alignment questions need timestamps the model can match against
 * news.publishedAt — this is the format the SYS prompt expects.
 */
function describePriceHistory(book: BookGrounding | null): string {
  const hist = book?.priceHistory ?? [];
  if (!hist.length) return 'Price history: unavailable.';
  // Cap at ~24 points so we don't blow the prompt with hourly data > 1d.
  const stride = Math.max(1, Math.ceil(hist.length / 24));
  const sampled: typeof hist = [];
  for (let i = 0; i < hist.length; i += stride) sampled.push(hist[i]!);
  // Always include the very last bar so "now" is anchored.
  const last = hist[hist.length - 1]!;
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  const lines = sampled.map((pt) => {
    const iso = new Date(pt.t * 1000).toISOString().replace('.000Z', 'Z');
    return `  ${iso}  ${(pt.p * 100).toFixed(1)}¢`;
  }).join('\n');
  const first = sampled[0]!;
  const moveC = ((last.p - first.p) * 100);
  const minP = Math.min(...sampled.map((s) => s.p));
  const maxP = Math.max(...sampled.map((s) => s.p));
  const range = `range ${(minP * 100).toFixed(1)}¢ → ${(maxP * 100).toFixed(1)}¢`;
  return `Price history [price-history] (${sampled.length} bars over ${(((last.t - first.t) / 3600) | 0)}h, ${range}, net ${moveC >= 0 ? '+' : ''}${moveC.toFixed(1)}¢):
${lines}`;
}

function describeHolders(holders: HoldersGrounding | null): string {
  if (!holders) return 'Holders: unavailable.';
  const rows = holders.rows.slice(0, 10).map((r, i) => {
    const label = r.label ? `${r.label} (${r.address})` : r.address;
    return `[whale-${i + 1}] ${label} · ${r.side.toUpperCase()} · $${r.sizeUsd.toFixed(0)} · ${r.shares.toFixed(0)} shares`;
  }).join('\n');
  const stats = `[whale-stats] top-5 concentration: ${holders.concentrationTop5Pct}% · total tracked: $${holders.totalHolderUsd} · YES $${holders.sideBias.yesUsd} vs NO $${holders.sideBias.noUsd} (YES ${holders.sideBias.yesPct}%)`;
  return `Top holders:\n${rows}\n${stats}`;
}

function describeNews(news: NewsGrounding | null): string {
  if (!news || !news.items.length) return 'News (72h): no catalysts surfaced.';
  // Top 12 (was 6). Reasoning models handle the larger context fine, and
  // "what's the most recent catalyst" type questions need a wider window
  // than 6 articles to find the actual market-moving item.
  const items = news.items.slice(0, 12).map((n, i) =>
    `[news-${i + 1}] ${n.headline} — ${n.source}${n.url ? ` (${n.url})` : ''}${n.snippet ? ` :: ${n.snippet.slice(0, 200)}` : ''}`
  ).join('\n');
  return `News (72h):\n${items}`;
}

function describeTweets(tweets: AskTweet[] | undefined): string {
  if (!tweets || tweets.length === 0) {
    return 'Vetted X handles (last 14d): no tweets matched.';
  }
  const items = tweets.slice(0, 10).map((t, i) => {
    const handle = (t.handle || '').replace(/^@/, '');
    const ts = t.createdAt ? ` · ${t.createdAt.slice(0, 10)}` : '';
    const url = t.url ? ` (${t.url})` : '';
    const text = (t.text || '').replace(/\s+/g, ' ').slice(0, 240);
    return `[kol-${i + 1}] @${handle}${ts}${url} :: ${text}`;
  }).join('\n');
  return `Vetted X handles (last 14d):\n${items}`;
}

function describeMarket(m: MarketMeta): string {
  return `Market: ${m.title}
- Category: ${m.category}
- YES: ${m.yes != null ? `${(m.yes * 100).toFixed(1)}¢` : '—'}
- NO: ${m.no != null ? `${(m.no * 100).toFixed(1)}¢` : '—'}
- 24h Volume: $${m.volume24hr.toFixed(0)}
- Ends: ${m.endDate ?? '—'}`;
}

/**
 * Collect raw payloads for every pill we could plausibly cite, so the frontend
 * popovers can render the same way Brief pills do.
 */
function buildCitationRegistry(
  book: BookGrounding | null,
  holders: HoldersGrounding | null,
  news: NewsGrounding | null,
  tweets?: AskTweet[]
): Map<string, Citation> {
  const m = new Map<string, Citation>();
  if (book) {
    m.set('book-stats', {
      id: 'book-stats',
      kind: 'book',
      label: 'book-stats',
      payload: { mid: book.mid, spread: book.spread, topDepthUsd: book.topDepthUsd, slippage: book.slippage },
    });
    book.bids.forEach((lvl, i) => {
      const id = `book-${i + 1}b`;
      m.set(id, { id, kind: 'book', label: id, payload: { side: 'bid', ...lvl } });
    });
    book.asks.forEach((lvl, i) => {
      const id = `book-${i + 1}a`;
      m.set(id, { id, kind: 'book', label: id, payload: { side: 'ask', ...lvl } });
    });
    if (book.priceHistory && book.priceHistory.length) {
      m.set('price-history', {
        id: 'price-history',
        kind: 'book',
        label: 'price-history',
        payload: { points: book.priceHistory },
      });
    }
  }
  if (holders) {
    m.set('whale-stats', {
      id: 'whale-stats',
      kind: 'whale',
      label: 'whale-stats',
      payload: {
        concentrationTop5Pct: holders.concentrationTop5Pct,
        totalHolderUsd: holders.totalHolderUsd,
        sideBias: holders.sideBias,
      },
    });
    holders.rows.forEach((row, i) => {
      const id = `whale-${i + 1}`;
      m.set(id, { id, kind: 'whale', label: id, payload: row });
    });
  }
  if (news) {
    news.items.forEach((item, i) => {
      const id = `news-${i + 1}`;
      m.set(id, { id, kind: 'news', label: id, payload: item, url: item.url });
    });
  }
  if (tweets) {
    tweets.forEach((t, i) => {
      const id = `kol-${i + 1}`;
      const handle = (t.handle || '').replace(/^@/, '');
      const cit: Citation = {
        id,
        kind: 'kol',
        label: `@${handle}`,
        payload: t,
      };
      if (t.url) cit.url = t.url;
      m.set(id, cit);
    });
  }
  return m;
}

/**
 * Normalise whatever citation labels the model emits to our canonical set
 * (handles both [news·1] middle-dot and [news-1] hyphen).
 */
function canonPillId(raw: string): string {
  return raw
    .replace(/[\[\]]/g, '')
    .trim()
    .replace(/·/g, '-')
    .toLowerCase();
}

// ---------- Section enforcement helpers ----------
// The Chat UI renders one block per claim, keyed off the markdown bold
// section label at the start of each claim's text. We enforce a fixed set
// of sections in canonical order so every answer is shaped consistently.

type CanonSection =
  | 'numbers'
  | 'holders'
  | 'catalysts'
  | 'sentiment'
  | 'thesis-yes'
  | 'thesis-no';

const SECTION_ORDER: CanonSection[] = [
  'numbers',
  'holders',
  'catalysts',
  'sentiment',
  'thesis-yes',
  'thesis-no',
];

// Matches `**Section name:**` at the START of a claim. Captures the label.
const SECTION_LABEL_RX = /^\*\*([^*]+?):\*\*\s*/;

/** Map a free-text section label (model output) to a canonical key. Lenient
 *  on capitalisation, parens, and punctuation so "Thesis (Yes)", "thesis yes",
 *  and "THESIS-YES" all collapse to 'thesis-yes'. */
function canonicalSection(raw: string): CanonSection | null {
  const norm = raw.toLowerCase().trim();
  if (norm.startsWith('number')) return 'numbers';
  if (norm.startsWith('holder')) return 'holders';
  if (norm.startsWith('catalyst')) return 'catalysts';
  if (norm.startsWith('sentiment')) return 'sentiment';
  if (norm.includes('thesis') && norm.includes('yes')) return 'thesis-yes';
  if (norm.includes('thesis') && norm.includes('no')) return 'thesis-no';
  if (norm === 'thesis') return 'thesis-yes'; // ambiguous → bull case by default
  return null;
}

/** Pretty label used in the placeholder text. Matches what the Chat UI
 *  expects (`**Numbers:** body`, `**Thesis (YES):** body`, etc.). */
function sectionLabel(s: CanonSection): string {
  switch (s) {
    case 'numbers': return '**Numbers:**';
    case 'holders': return '**Holders:**';
    case 'catalysts': return '**Catalysts:**';
    case 'sentiment': return '**Sentiment:**';
    case 'thesis-yes': return '**Thesis (YES):**';
    case 'thesis-no': return '**Thesis (NO):**';
  }
}

/** Position of a claim in the canonical order, for sort. Unrecognised
 *  claims sort to the end. */
function orderOf(c: Claim): number {
  const m = c.text.match(SECTION_LABEL_RX);
  if (!m) return SECTION_ORDER.length + 1;
  const canon = canonicalSection(m[1]!.trim());
  if (!canon) return SECTION_ORDER.length + 1;
  return SECTION_ORDER.indexOf(canon);
}

/** Salvage sectioned claims directly from raw model text when JSON
 *  parsing failed. The model usually still wrote the `**Section:**`
 *  blocks correctly even when the surrounding JSON is malformed
 *  (trailing comma, unclosed brace, extra prose around the JSON, etc.).
 *  Pulling them out by regex lets the user see the structured answer
 *  instead of a "malformed JSON" dead-end.
 *
 *  We split the text on `**Label:**` markers and capture each block's
 *  body until the next marker. Citations are scraped from `[id]`
 *  patterns inside the body and validated against the upstream registry.
 *  Bare punctuation, JSON syntax fragments, and quote characters are
 *  cleaned up so the body reads as prose.
 */
function salvageSectionedClaims(
  raw: string,
  registry: Map<string, Citation>,
): Claim[] {
  if (!raw) return [];
  // Strip code fences if the model wrapped the response in ```...```.
  const fenced = raw.match(/```(?:json|markdown)?\s*([\s\S]*?)\s*```/i);
  const text = (fenced && fenced[1]) ? fenced[1] : raw;
  // Find every `**Label:**` marker and the body that follows up to the
  // next marker (or end of text). The leading group captures the label
  // (e.g. "Numbers", "Thesis (YES)"), the trailing group captures the
  // body. The look-ahead `(?=\*\*[^*]+:\*\*|$)` stops the body at the
  // next section marker without consuming it.
  const blockRx = /\*\*([^*\n]{1,40}?):\*\*\s*([\s\S]*?)(?=\n?\*\*[^*\n]{1,40}?:\*\*|\s*$)/g;
  const claims: Claim[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRx.exec(text)) !== null) {
    const label = m[1]!.trim();
    const canon = canonicalSection(label);
    if (!canon) continue;
    let body = m[2]!.trim();
    // Strip trailing JSON syntax garbage that often leaks in when JSON
    // parsing failed: stray quotes, commas, brackets, braces.
    body = body
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/[,;}\]]+$/g, '')
      .trim();
    if (!body) continue;
    // Cap length per section; the SYS prompt's per-section budget is 60
    // words, so 600 chars is a generous cap that prevents one runaway
    // block from eating the screen.
    if (body.length > 600) body = body.slice(0, 600).trim() + '…';
    const citations: string[] = [];
    const citeRx = /\[([a-z0-9][a-z0-9\-·]*?)\]/gi;
    let cm: RegExpExecArray | null;
    while ((cm = citeRx.exec(body)) !== null) {
      const cid = canonPillId(cm[1]!);
      if (registry.has(cid) && !citations.includes(cid)) citations.push(cid);
    }
    claims.push({ text: `${sectionLabel(canon)} ${body}`, citations });
  }
  return claims;
}

/** Build a labeled disclaimer claim for a section the model dropped. We
 *  cite stats pills when they're available in the registry so the
 *  placeholder still has something for the trader to inspect; if not,
 *  the citations array is empty (which the UI permits for disclaimer
 *  rows specifically — substantive sections still must cite). */
function buildSectionPlaceholder(
  sec: CanonSection,
  registry: Map<string, Citation>,
): { claim: Claim } {
  const label = sectionLabel(sec);
  const cite = (id: string): string[] => (registry.has(id) ? [id] : []);
  switch (sec) {
    case 'numbers':
      return {
        claim: {
          text: `${label} live orderbook and price history are in the market panel above.`,
          citations: cite('book-stats'),
        },
      };
    case 'holders':
      return {
        claim: {
          text: `${label} see the holders panel for full positioning. top-5 concentration and side bias come from [whale-stats] when available.`,
          citations: cite('whale-stats'),
        },
      };
    case 'catalysts':
      return {
        claim: {
          text: `${label} no news catalysts in the last 72h. this market is moving on positioning alone.`,
          citations: [],
        },
      };
    case 'sentiment':
      return {
        claim: {
          text: `${label} no vetted-handle X posts surfaced for this market this run. configure xAI live search in setup, or check the sentiment tab for a deeper sweep.`,
          citations: [],
        },
      };
    case 'thesis-yes':
      return {
        claim: {
          text: `${label} the bull case wasn't synthesised this run. the YES-side evidence in the brief was thin. re-ask with a narrower YES-focused prompt for a sharper read.`,
          citations: [],
        },
      };
    case 'thesis-no':
      return {
        claim: {
          text: `${label} the bear case wasn't synthesised this run, same reason. a targeted "what would kill the YES thesis" question gets a sharper answer.`,
          citations: [],
        },
      };
  }
}

/**
 * Fast-path: deterministic answers for the most common demo questions.
 * These never call the LLM, so they CANNOT time out. Returns null if the
 * question doesn't match any pattern, in which case we fall through to the
 * full LLM path.
 */
function fastPath(
  question: string,
  grounding: AskGrounding,
  registry: Map<string, Citation>
): AskAnswer | null {
  const q = question.toLowerCase().trim();

  // Pattern 1: top holders / who holds / smart money / whales
  const isHoldersQ = /\b(top|biggest|largest)\b.*\b(holder|whale|wallet|position)/i.test(q)
    || /\bwho.*(?:hold|own|position)/i.test(q)
    || /\bsmart money\b/i.test(q);

  if (isHoldersQ && grounding.holders && grounding.holders.rows.length) {
    const sideMatch = q.match(/\b(yes|no)\b/);
    const targetSide = sideMatch ? (sideMatch[1] as 'yes' | 'no') : null;

    let rows = grounding.holders.rows;
    if (targetSide) rows = rows.filter(r => r.side === targetSide);
    rows = rows.slice(0, 3);

    if (rows.length) {
      const cits: string[] = [];
      const used = new Map<string, Citation>();
      const parts = rows.map((r, i) => {
        const idx = grounding.holders!.rows.indexOf(r) + 1;
        const id = `whale-${idx}`;
        cits.push(id);
        const c = registry.get(id);
        if (c) used.set(id, c);
        const name = r.label && r.label.length < 30 ? r.label : `${r.address.slice(0, 6)}…${r.address.slice(-4)}`;
        return `${i === 0 ? 'Top' : `#${i + 1}`}: ${name} on ${r.side.toUpperCase()} with $${Math.round(r.sizeUsd).toLocaleString()} [${id}]`;
      });
      const sideLabel = targetSide ? ` on ${targetSide.toUpperCase()}` : '';
      const text = `${parts.join('. ')}.${grounding.holders.sideBias ? ` (overall split: YES ${grounding.holders.sideBias.yesPct}% / NO ${100 - grounding.holders.sideBias.yesPct}%)` : ''}`;
      return {
        claims: [{ text, citations: cits }],
        citations: Array.from(used.values()),
      };
    }
  }

  // Pattern 2: current spread / book / liquidity / mid
  const isSpreadQ = /\b(spread|mid|order ?book|liquidity|depth|tight|wide)\b/i.test(q);
  if (isSpreadQ && grounding.book && grounding.book.bids.length && grounding.book.asks.length) {
    const b = grounding.book;
    const topBid = b.bids[0]!;
    const topAsk = b.asks[0]!;
    const bookStats = registry.get('book-stats');
    const bookB1 = registry.get('book-1b');
    const bookA1 = registry.get('book-1a');
    const cits: Citation[] = [];
    if (bookStats) cits.push(bookStats);
    if (bookB1) cits.push(bookB1);
    if (bookA1) cits.push(bookA1);
    const text = `Mid is ${b.mid != null ? (b.mid * 100).toFixed(1) + '¢' : '—'} with a ${b.spread != null ? (b.spread * 100).toFixed(1) + '¢' : '—'} spread [book-stats]. Top bid ${(topBid.price * 100).toFixed(1)}¢ × ${Math.round(topBid.size)} [book-1b], top ask ${(topAsk.price * 100).toFixed(1)}¢ × ${Math.round(topAsk.size)} [book-1a]. Depth within ±5¢ of mid: $${Math.round(b.topDepthUsd).toLocaleString()}.`;
    return {
      claims: [{ text, citations: ['book-stats', 'book-1b', 'book-1a'] }],
      citations: cits,
    };
  }

  return null;
}

export type AskGrounding = {
  book: BookGrounding | null;
  holders: HoldersGrounding | null;
  news: NewsGrounding | null;
  /** Vetted-handle X tweets matched to this market. Optional — when present
   *  the LLM is given the [kol-N] citation set; when absent the SYS prompt
   *  tells the model X data isn't available so it doesn't fabricate. */
  tweets?: AskTweet[];
};

export async function runAsk(
  market: MarketMeta,
  grounding: AskGrounding,
  question: string,
  emit: (ev: AskEvent) => void
): Promise<AskAnswer> {
  const started = Date.now();
  emit({ t: 'ask:start' });

  // Try the deterministic fast path first — never times out, never fails.
  const registry = buildCitationRegistry(grounding.book, grounding.holders, grounding.news, grounding.tweets);
  const fast = fastPath(question, grounding, registry);
  if (fast) {
    const elapsedMs = Date.now() - started;
    emit({ t: 'ask:done', answer: fast, elapsedMs });
    return fast;
  }

  emit({ t: 'ask:progress', message: 'synthesising grounded answer…' });

  const prompt = `${describeMarket(market)}

${describeBook(grounding.book)}

${describePriceHistory(grounding.book)}

${describeHolders(grounding.holders)}

${describeNews(grounding.news)}

${describeTweets(grounding.tweets)}

QUESTION: ${question.trim()}

Respond ONLY with the JSON object described in the system prompt.`;

  // Reasoning tier so quality matches a research-desk answer.
  // The contention problem with brief synthesis is solved by lane='ask',
  // which runs in a dedicated 2-slot pool instead of queuing behind the
  // 4-slot brief lane (Market+Holders+News+Synthesis).
  // 120s timeout: subprocess startup + reasoning on long prompt can run 30-90s,
  // bumped past 60s so a slow call doesn't dead-air the UI.
  const res = await getProvider().complete(prompt, {
    tier: 'reasoning',
    systemPrompt: SYS,
    allowedTools: [],
    jsonOnly: true,
    timeoutMs: 120_000,
    lane: 'ask',
  });

  type RawClaim = { text?: string; citations?: string[] };
  const parsed = res.ok ? extractJson<unknown>(res.text) : null;

  // Handle multiple shapes the model may emit:
  //   { claims: [...] }                    ← happy path
  //   [ {...}, {...} ]                     ← array directly
  //   { answer: "...", citations: [...] }  ← single-claim flat object
  //   { text: "...", citations: [...] }    ← single-claim flat object (alt)
  const rawClaims: RawClaim[] = (() => {
    if (!parsed) return [];
    if (Array.isArray(parsed)) return parsed as RawClaim[];
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.claims)) return obj.claims as RawClaim[];
    if (typeof obj.text === 'string') return [{ text: obj.text, citations: obj.citations as string[] | undefined }];
    if (typeof obj.answer === 'string') return [{ text: obj.answer, citations: obj.citations as string[] | undefined }];
    return [];
  })();

  const claims: Claim[] = [];
  const usedCitations = new Map<string, Citation>();

  for (const rc of rawClaims) {
    if (!rc || typeof rc.text !== 'string') continue;
    const text = rc.text.trim();
    if (!text) continue;
    const citations = Array.isArray(rc.citations)
      ? Array.from(new Set(rc.citations.map(canonPillId))).filter((id) => registry.has(id))
      : [];
    for (const cid of citations) {
      const cit = registry.get(cid);
      if (cit && !usedCitations.has(cid)) usedCitations.set(cid, cit);
    }
    claims.push({ text, citations });
  }

  // First-line salvage: when JSON parsing failed (extra prose, trailing
  // commas, unclosed braces — common on longer SYS prompts), the raw text
  // often still contains the `**Section:**` blocks the model meant to put
  // inside the JSON. Pull those out by regex so the user gets the
  // structured answer they would have gotten with valid JSON, instead of
  // a "malformed JSON" dead-end.
  if (!claims.length && res.ok && res.text) {
    const salvaged = salvageSectionedClaims(res.text, registry);
    if (salvaged.length > 0) {
      console.warn(
        `[ask] salvaged ${salvaged.length} sectioned claims from non-JSON model output`,
      );
      for (const claim of salvaged) {
        for (const cid of claim.citations) {
          const cit = registry.get(cid);
          if (cit && !usedCitations.has(cid)) usedCitations.set(cid, cit);
        }
        claims.push(claim);
      }
    }
  }

  // Last-resort fallback: still no claims and we have text. Display the
  // raw text (truncated) so the user sees something. If the text is
  // JSON-shaped but unparseable, log it for debugging — the bracket check
  // is just a hint that we're past plain-prose territory.
  if (!claims.length && res.ok && res.text) {
    let fallback = res.text.trim();
    const fence = fallback.match(/```(?:json|markdown)?\s*([\s\S]*?)\s*```/i);
    if (fence && fence[1]) fallback = fence[1].trim();
    if (/^[\[{]/.test(fallback)) {
      console.error('[ask] unparseable JSON-shaped output:', fallback.slice(0, 600));
      // Show the raw output anyway — it usually contains useful prose
      // even when the JSON wrapper is broken. Better to give the user
      // the model's actual words than a cryptic "malformed JSON" line.
      fallback = fallback.slice(0, 1500);
    } else {
      fallback = fallback.slice(0, 1500);
    }
    claims.push({ text: fallback, citations: [] });
  }

  if (!claims.length) {
    claims.push({
      text: `Answer unavailable: ${res.error ?? 'LLM call failed'}.`,
      citations: [],
    });
  }

  // Section-completeness pass: even with the SYS prompt requiring all six
  // sections, the model regularly drops 2-4 of them when grounding for that
  // section is thin (no recent news → no Catalysts; no tweets → no Sentiment;
  // narrow question → no Thesis). That makes the answer feel half-finished
  // and — worse — a question like "what's the sentiment?" can come back
  // without a Sentiment section, which is unacceptable.
  //
  // We enforce the contract in code: detect which sections the model
  // returned and inject a labeled placeholder claim for any missing ones,
  // in canonical order. The model's own claims keep their original order
  // among themselves; placeholders fill the gaps. The fallback path
  // (single un-sectioned claim, e.g. "Answer unavailable: …") is left
  // alone — that's a different shape and the user shouldn't see fake
  // sections wrapping a parse error.
  const isFallback = claims.length === 1 && !SECTION_LABEL_RX.test(claims[0]!.text);
  if (!isFallback) {
    const present = new Set<CanonSection>();
    for (const c of claims) {
      const m = c.text.match(SECTION_LABEL_RX);
      if (m) {
        const canon = canonicalSection(m[1]!.trim());
        if (canon) present.add(canon);
      }
    }
    const missing = SECTION_ORDER.filter((s) => !present.has(s));
    if (missing.length > 0) {
      // Build placeholders. We can supply a citation for two of them when
      // the upstream registry has the relevant data (book-stats for
      // Numbers, whale-stats for Holders) so the disclaimer still has at
      // least one anchored pill.
      for (const sec of missing) {
        const placeholder = buildSectionPlaceholder(sec, registry);
        claims.push(placeholder.claim);
        for (const cid of placeholder.claim.citations) {
          const cit = registry.get(cid);
          if (cit && !usedCitations.has(cid)) usedCitations.set(cid, cit);
        }
      }
      // Re-sort claims by canonical section order so Numbers always comes
      // first, Thesis (NO) always last. Claims without a recognised label
      // (shouldn't exist after this pass, but be defensive) sort to the
      // end in their original order.
      claims.sort((a, b) => orderOf(a) - orderOf(b));
    }
  }

  const answer: AskAnswer = {
    claims,
    citations: Array.from(usedCitations.values()),
  };

  const elapsedMs = Date.now() - started;
  if (res.ok) {
    emit({ t: 'ask:done', answer, elapsedMs });
  } else {
    emit({ t: 'ask:error', error: res.error ?? 'unknown', elapsedMs });
  }
  return answer;
}
