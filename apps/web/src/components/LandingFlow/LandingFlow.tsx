// LandingFlow — the pre-desk experience. Lifted from the
// research-desk/flow.html design bundle and adapted to React. Four stages:
//
//   1. landing  — hero pitch + manifest of the seven agents + sign-in CTA
//   2. auth     — wallet picker (Polymarket users), proceeds to address paste
//   3. twitter  — optional X handle so news weighting sees "accounts you trust"
//   4. handoff  — short loader, then the parent flips to the desk
//
// What's deliberately simpler than the design bundle:
//   - No real WalletConnect / MetaMask / Coinbase SDK. Each wallet row
//     opens the same address-paste step, persists locally, done. We carry
//     the visual flow forward — the SDK can land later behind the same
//     onConnect callback and the user-facing UX stays identical.
//   - The X "connect with X" button is a stub that focuses the handle
//     input. Real OAuth requires app registration on x.com/developers.
//
// Voice: lowercase, mono headers, terse. Carried verbatim from the design
// bundle which was already in this repo's voice (the design tool was
// instructed against it).

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isPlausibleEvmAddress } from '../../hooks/useAuth';
import './landing.css';

// v1 simplification (May 2026): the wallet-picker stage is gone. Live
// wallet-connect (MetaMask / Coinbase / WalletConnect) made the flow heavier
// without delivering more than the paste path — pm-copilot is read-only, we
// only need the address to look up positions. Tradeable execution comes in
// v2; until then a pasted address is the single, simplest entry point.
type Stage = 'landing' | 'auth-paste' | 'twitter' | 'handoff';

// EthereumProvider injected-wallet shape lived here until v1 simplification
// dropped the wallet-picker stage in May 2026. Re-add when v2 brings
// tradeable execution back into scope.

export interface LandingFlowProps {
  /** Called once the user has at minimum a wallet address. The hook then
   *  also calls onComplete after the optional X handle step (or skip). */
  onConnectWallet: (addr: string) => void;
  /** Called when the user submits or skips the X handle step. The flow
   *  itself transitions to the handoff loader; the parent should flip
   *  the auth gate to "signed in" so the next render mounts the desk. */
  onSubmitHandle: (handle: string | null) => void;
  /** Called after the handoff loader completes. The parent uses this to
   *  un-mount the LandingFlow once the gate has updated. */
  onHandoffComplete: () => void;
}

// Live ticker pulls from /api/events on mount. We pre-render with a
// stale-while-revalidate cache from localStorage so the strip is never
// empty — second-and-later visits see the last good fetch instantly,
// then swap in the new data when the network returns.
type TickerItem = {
  /** Truncated event title, lowercase. */
  name: string;
  /** Candidate / outcome label when the event has > 2 outcomes; null
   *  for binary markets where the title already contains the question. */
  outcome: string | null;
  /** YES probability for the leading outcome, 2 decimals. */
  price: string;
  /** Pre-formatted 24h volume (e.g. "$2.1m" or "$340k"). May be empty. */
  vol: string;
  /** YES > 0.55 = up, < 0.45 = down, middle = flat. Drives price color. */
  dir: 'up' | 'down' | 'flat';
};

// Curated baseline shown on first paint until the fetch returns. These
// are evergreen markets that are usually live; even if the real fetch
// fails entirely the strip stays meaningful instead of empty. Numbers
// are illustrative — the live fetch overwrites them within a second.
const FALLBACK_TICKER: TickerItem[] = [
  { name: 'btc all-time high in 2026', outcome: null, price: '0.78', vol: '$2.4m', dir: 'up' },
  { name: 'fed cuts rates by july', outcome: null, price: '0.42', vol: '$1.1m', dir: 'flat' },
  { name: 'recession in 2026', outcome: null, price: '0.21', vol: '$680k', dir: 'down' },
  { name: '2028 dem nominee', outcome: 'newsom', price: '0.31', vol: '$910k', dir: 'flat' },
  { name: 'tsmc 2nm yields by q2', outcome: null, price: '0.61', vol: '$240k', dir: 'up' },
  { name: 'ucl winner 2025-26', outcome: 'real madrid', price: '0.27', vol: '$1.6m', dir: 'down' },
  { name: 'nba mvp 2026', outcome: 'jokic', price: '0.45', vol: '$540k', dir: 'flat' },
  { name: 'iran-us deal by year end', outcome: null, price: '0.17', vol: '$320k', dir: 'down' },
];

// Bump the version when ticker logic changes (resolved-market filter,
// outcome-label rules, etc.) so users with stale cache from a previous
// release pick up the new behaviour on next load instead of seeing
// cached "0.10 with no label" or "péter magyar 1.00" rows for 5 mins.
const TICKER_CACHE_KEY = 'pm-copilot:ticker-cache:v4';
const TICKER_CACHE_TTL_MS = 5 * 60 * 1000;

// Categories we sample for the ticker. Mixed so the strip doesn't feel like
// a single-vertical scroll — politics + crypto + sports + geopolitics is
// roughly the live diversity on the actual desk.
const TICKER_CATEGORIES = ['politics', 'crypto', 'sports', 'geopolitics'] as const;

// Trim long titles down for the ticker; shows the first ~36 chars and adds
// an ellipsis if it cut. Keeps the strip visually consistent.
function shortTitle(s: string): string {
  const t = s.trim().toLowerCase();
  return t.length > 36 ? t.slice(0, 35) + '…' : t;
}

function shortLabel(s: string): string {
  const t = s.trim().toLowerCase();
  return t.length > 18 ? t.slice(0, 17) + '…' : t;
}

function fmtVol(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

/** Read cached ticker items if present and not stale. Returns null on
 *  miss or parse error. Lets repeat visitors see real markets instantly
 *  while the network refresh runs in the background. */
function readTickerCache(): TickerItem[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TICKER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; items?: TickerItem[] };
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > TICKER_CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return parsed.items;
  } catch {
    return null;
  }
}

function writeTickerCache(items: TickerItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      TICKER_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), items }),
    );
  } catch {
    // quota / storage disabled — fine, we just don't cache this run
  }
}

// Light type for the /api/events response shape we actually consume here.
type ApiEventsResponse = {
  events?: Array<{
    title?: string;
    volume24hr?: number;
    isMultiOutcome?: boolean;
    outcomes?: Array<{ label?: string; yes?: number; volume24hr?: number }>;
  }>;
};

/** Pull a TickerItem out of one event. Returns null if there's no
 *  actively-trading outcome to surface. */
function eventToTickerItem(ev: ApiEventsResponse['events'] extends (infer T)[] | undefined ? T : never): TickerItem | null {
  if (!ev || !ev.title) return null;
  const outcomes = Array.isArray(ev.outcomes) ? ev.outcomes : [];
  // Filter out RESOLVED outcomes. yes ≤ 0.02 is effectively a "no, this
  // candidate already lost" market; yes ≥ 0.98 is "yes, this already
  // happened" — both are settled and shouldn't show in a trending strip
  // (user reported péter magyar at 1.00 in the hungary PM event, which
  // was the bug). Keep the bracket [0.02, 0.98] for live markets only.
  // Then pick the highest-YES outcome.
  const ranked = outcomes
    .filter((o) => typeof o.yes === 'number' && o.yes > 0.02 && o.yes < 0.98)
    .sort((a, b) => (b.yes as number) - (a.yes as number));
  const top = ranked[0];
  if (!top || typeof top.yes !== 'number') return null;
  const price = top.yes.toFixed(2);
  const vol = fmtVol(ev.volume24hr ?? top.volume24hr ?? null);
  const dir: 'up' | 'down' | 'flat' =
    top.yes >= 0.55 ? 'up' : top.yes <= 0.45 ? 'down' : 'flat';
  // Outcome label: show whenever the label carries information beyond
  // what the title already says. Earlier version checked outcomes.length
  // and an isMultiOutcome flag, but the API often returns the event in
  // a shape where each candidate is its own market with only the
  // leader's row populated (so outcomes.length === 1 but the event IS
  // multi-outcome). Just look at the label itself: if it's something
  // other than "Yes"/"No"/empty and it's not literally the title, show it.
  const lbl = top.label ? top.label.trim() : '';
  const titleLower = ev.title.trim().toLowerCase();
  const lblLower = lbl.toLowerCase();
  const isYesNo = /^yes$/i.test(lbl) || /^no$/i.test(lbl);
  const isTitleEcho = lblLower === titleLower || titleLower.includes(lblLower) && lblLower.length > 8;
  const showOutcome = lbl !== '' && !isYesNo && !isTitleEcho;
  return {
    name: shortTitle(ev.title),
    outcome: showOutcome ? shortLabel(lbl) : null,
    price,
    vol,
    dir,
  };
}

const AGENTS: Array<[string, string, string, string]> = [
  ['01', 'book.agent', '[book-1a]', 'polymarket CLOB. mid, spread, depth at ±5¢, slippage for $10k/$50k/$100k.'],
  ['02', 'holders.agent', '[whale-3]', 'top wallet table. concentration, side bias, recent rotations.'],
  ['03', 'news.agent', '[news-7]', '72h news from a per-category allowlist. wikipedia, medium, reddit hard-banned.'],
  ['04', 'sentiment.agent', '[kol-2]', 'vetted X handles only via xAI live search. quotes the post, stamps the time.'],
  ['05', 'thesis.agent', '[thesis]', 'causal claim tree. supports vs challenges, kill-thesis pass.'],
  ['06', 'comparables.agent', '[comp-4]', 'resolved polymarket markets with similar shape. base rate when n ≥ 3.'],
  ['07', 'synthesis.agent', '∅ allowlist', 'merges the six. drops any cite id not in upstream evidence.'],
];

export function LandingFlow({
  onConnectWallet,
  onSubmitHandle,
  onHandoffComplete,
}: LandingFlowProps) {
  const [stage, setStage] = useState<Stage>('landing');
  const [addr, setAddr] = useState('');
  const [addrError, setAddrError] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  // Landing command-row input — accepts either a Polymarket URL (resolves +
  // navigates to the market view bypassing sign-in, since the workbench
  // already lets signed-out users read shared market links) OR routes to
  // the wallet sign-in modal when empty. Fixes the UX bug where the static
  // "paste polymarket url" placeholder led users to click "open desk" and
  // then get confused by the wallet-paste modal that asks for "polymarket
  // address" (which meant wallet, not URL).
  const [heroInput, setHeroInput] = useState('');
  const [heroBusy, setHeroBusy] = useState(false);
  const [heroError, setHeroError] = useState<string | null>(null);
  // Server-side verifier state for the X handle input — debounced existence
  // check via /api/verify-handle. 'idle' before user types, 'checking' while
  // the request is in flight, 'ok' / 'notfound' / 'unknown' after it returns.
  // Drives the small status indicator next to the input.
  type HandleCheck = 'idle' | 'checking' | 'ok' | 'notfound' | 'unknown';
  const [handleCheck, setHandleCheck] = useState<HandleCheck>('idle');
  const handleInputRef = useRef<HTMLInputElement | null>(null);
  // Lazy-init from cache so repeat visitors see real markets on first
  // paint. New visitors see the curated FALLBACK_TICKER until the network
  // returns (usually <1s on a warm server cache).
  const [tickerItems, setTickerItems] = useState<TickerItem[]>(
    () => readTickerCache() ?? FALLBACK_TICKER,
  );

  // Fetch trending Polymarket markets for the ticker. Same /api/events
  // endpoint the LeftRail uses, so the server-side cache is shared and
  // warm. Each category fires in parallel and we render whichever comes
  // back first instead of waiting for all four — the ticker updates
  // incrementally as data lands, no perceptible "loading" state.
  useEffect(() => {
    let cancelled = false;
    const collected: Array<Array<NonNullable<ApiEventsResponse['events']>[number]>> = [];

    TICKER_CATEGORIES.forEach((cat, idx) => {
      // Each category fetches independently and updates state as soon as
      // it lands. This makes the ticker FEEL instant: by the time the
      // user's eye moves from the headline to the strip, real markets
      // have already swapped in. Round-robin merge runs on every update.
      collected[idx] = [];
      void (async () => {
        try {
          const r = await fetch(`/api/events?category=${cat}&limit=8&mode=contested`);
          if (!r.ok || cancelled) return;
          const j = (await r.json()) as ApiEventsResponse;
          collected[idx] = Array.isArray(j.events) ? j.events : [];
          if (cancelled) return;

          // Round-robin merge. By selecting the leader from each category
          // before moving to the second-place market, the strip always
          // surfaces the most-traded event from each vertical, even when
          // one category dominates by volume.
          //
          // Dedupe by lowercased title: Polymarket events are routinely
          // tagged in multiple categories (the US/Iran peace deal sits in
          // both politics AND geopolitics, for example), so without this
          // the same market shows up twice in adjacent positions, and
          // the 3x track render makes the duplication especially visible
          // at category seams.
          const items: TickerItem[] = [];
          const seenTitles = new Set<string>();
          const maxLen = Math.max(...collected.map((l) => l.length), 0);
          for (let i = 0; i < maxLen && items.length < 16; i++) {
            for (const list of collected) {
              const ev = list[i];
              if (!ev || !ev.title) continue;
              const titleKey = ev.title.trim().toLowerCase();
              if (seenTitles.has(titleKey)) continue;
              const item = eventToTickerItem(ev);
              if (!item) continue;
              seenTitles.add(titleKey);
              items.push(item);
              if (items.length >= 16) break;
            }
          }
          if (items.length > 0) {
            setTickerItems(items);
            writeTickerCache(items);
          }
        } catch {
          // network/json failure — keep whatever items already landed
          // (or the fallback). No toast, no error UI: the strip is
          // marketing decoration, not a blocking state.
        }
      })();
    });

    return () => { cancelled = true; };
  }, []);

  // Handoff loader sequence — five "priming" lines that cycle, then call
  // back so the parent unmounts this whole component and renders the desk.
  const [hoLine, setHoLine] = useState('priming agents…');
  useEffect(() => {
    if (stage !== 'handoff') return;
    const lines = [
      'priming agents.',
      'connecting to polymarket gamma.',
      'wiring the citation registry.',
      'warming the orderbook stream.',
      'opening the desk.',
    ];
    let idx = 0;
    setHoLine(lines[0]!);
    const id = setInterval(() => {
      idx += 1;
      if (idx >= lines.length) {
        clearInterval(id);
        onHandoffComplete();
        return;
      }
      setHoLine(lines[idx]!);
    }, 700);
    return () => clearInterval(id);
  }, [stage, onHandoffComplete]);

  // Focus handle input on stage entry so power users can just type + ↵.
  useEffect(() => {
    if (stage === 'twitter') {
      const id = setTimeout(() => handleInputRef.current?.focus(), 80);
      return () => clearTimeout(id);
    }
    return;
  }, [stage]);

  // Resolve a Polymarket URL → marketId via /api/resolve, then hard-nav
  // to /m/<id>. Returns true on success. Used by both the landing command-
  // row and the auth modal so users can paste either a URL or a wallet in
  // either place and end up where they expect.
  const resolveAndNavigate = async (url: string): Promise<boolean> => {
    try {
      const r = await fetch(`/api/resolve?url=${encodeURIComponent(url)}`);
      if (!r.ok) return false;
      const j = (await r.json()) as { marketId?: string };
      if (!j.marketId) return false;
      window.location.href = `/m/${encodeURIComponent(j.marketId)}`;
      return true;
    } catch {
      return false;
    }
  };

  const looksLikePolymarketUrl = (s: string): boolean =>
    /polymarket\.com\/(event|markets)\//i.test(s);

  // Landing hero command-row submit. If the input is a Polymarket URL,
  // resolve and navigate directly (skipping the auth modal entirely —
  // signed-out users can read shared markets, sign in is for positions).
  // Empty input → open the sign-in modal. Anything else → inline error.
  const onSubmitHero = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = heroInput.trim();
    if (!trimmed) {
      setHeroError(null);
      setStage('auth-paste');
      return;
    }
    if (looksLikePolymarketUrl(trimmed)) {
      setHeroError(null);
      setHeroBusy(true);
      const ok = await resolveAndNavigate(trimmed);
      setHeroBusy(false);
      if (!ok) setHeroError('couldn\'t resolve that polymarket link. check the URL or try a different market.');
      return;
    }
    setHeroError('paste a polymarket.com URL, or leave empty and press enter to sign in.');
  };

  const onSubmitAddr = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = addr.trim();
    // Auth modal also accepts a Polymarket URL — users who reach this
    // modal after clicking a "paste polymarket URL" CTA naturally try
    // pasting the URL they just copied. Route them to the market instead
    // of rejecting with "not a valid 0x address".
    if (looksLikePolymarketUrl(trimmed)) {
      setAddrError(null);
      const ok = await resolveAndNavigate(trimmed);
      if (!ok) setAddrError('couldn\'t resolve that polymarket link. check the URL or paste a wallet address (0x…) to sign in.');
      return;
    }
    if (!isPlausibleEvmAddress(trimmed)) {
      setAddrError('paste a wallet address (0x…) to sign in, or a polymarket.com URL to browse a market.');
      return;
    }
    setAddrError(null);
    onConnectWallet(trimmed);
    setStage('twitter');
  };

  // Live verifier for the X handle input. Debounced 400ms — as the user
  // types, we POST the cleaned handle to /api/verify-handle and surface a
  // green / amber / red indicator next to the input. Non-blocking: a
  // 'notfound' result lets the user proceed anyway (they may have typoed
  // momentarily), but a 'ok' check gives them confidence before submit.
  useEffect(() => {
    if (stage !== 'twitter') return;
    const cleaned = handle.replace(/^@/, '').trim();
    if (!cleaned) { setHandleCheck('idle'); return; }
    // Format gate: Twitter handles are 1–15 chars, alphanumeric + underscore.
    // Reject obvious garbage without burning a network call.
    if (!/^[A-Za-z0-9_]{1,15}$/.test(cleaned)) {
      setHandleCheck('notfound');
      return;
    }
    setHandleCheck('checking');
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/verify-handle?h=${encodeURIComponent(cleaned)}`, {
          signal: ctrl.signal,
        });
        const body = (await res.json()) as { ok: boolean | 'unknown'; reason?: string };
        if (body.ok === true) setHandleCheck('ok');
        else if (body.ok === 'unknown') setHandleCheck('unknown');
        else setHandleCheck('notfound');
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setHandleCheck('unknown');
      }
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [handle, stage]);

  const onSubmitHandleForm = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = handle.replace(/^@/, '').trim();
    onSubmitHandle(cleaned || null);
    setStage('handoff');
  };

  const onSkipHandle = () => {
    onSubmitHandle(null);
    setStage('handoff');
  };

  return (
    <div className="lf-root">
      {/* utility bar — 3-col grid: wordmark / domain / actions */}
      <div className="lf-util-bar">
        <span className="brand-mini mono">
          <img src="/wordmark.svg" alt="pm copilot" className="util-logo" width={107} height={20} />
        </span>
        <span className="center-domain mono">pmcopilot.wtf</span>
        <span className="right mono">
          <span>open source</span>
          <span><span className="live-dot" />markets live</span>
          {/* SIGN IN — same destination as the hero "open desk" CTA, but
              available from the persistent top bar so returning users
              don't have to scroll to the hero command-row. */}
          <button
            type="button"
            className="util-signin mono"
            onClick={() => setStage('auth-paste')}
          >
            sign in
          </button>
        </span>
      </div>

      {/* ticker tape — seamless rolling marquee. Items are rendered three
          times in the track; the CSS animation translates by -33.333%
          per cycle so the loop snap is invisible (second copy is now
          where the first copy started). Markets pulled from /api/events
          for politics+crypto+sports+geopolitics. */}
      <div className="lf-ticker">
        <div className="lf-ticker-track">
          {[...tickerItems, ...tickerItems, ...tickerItems].map((it, i) => (
            <span key={i} className="lf-ticker-item mono">
              <span className="name">{it.name}</span>
              {it.outcome && <span className="outcome">{it.outcome}</span>}
              <span className={`price ${it.dir}`}>{it.price}</span>
              {it.vol && <span className="vol">{it.vol}</span>}
              <span className="sep-pipe">|</span>
            </span>
          ))}
        </div>
      </div>

      {/* ============== STAGE 1: landing ==============
          Visual direction from design-bundle/landing-redesign-mock.html.
          Hero (left text + right preview), three numbered bands, footer.
          All CTAs route to the existing auth-paste stage via setStage —
          no functional changes from the prior version. */}
      <div className={`lf-stage lf-stage-landing ${stage === 'landing' ? 'active' : ''}`}>
        <main className="land">
          {/* Hero band — left: pitch + command input; right: brief preview */}
          <section className="land-hero-band land-shell" aria-labelledby="hero-title">
            <div>
              <div className="land-eyebrow mono">
                <span>01</span>
                <span>polymarket intelligence</span>
                <span className="rule" />
                <span>read-only</span>
              </div>
              <h1 className="headline" id="hero-title">
                pmcopilot.wtf turns market chaos into <span className="accent">cited briefs.</span>
              </h1>
              <p className="lede">
                paste a polymarket url. pm copilot checks the book, holders, news,
                vetted x sentiment, resolved comparables, and thesis paths. every claim
                has to point back to a source id already produced upstream.
              </p>
              <form className="command-row" onSubmit={onSubmitHero}>
                <div className="command-input mono">
                  <span className="prompt">&gt;</span>
                  <input
                    type="text"
                    className="command-input-field mono"
                    placeholder="https://polymarket.com/event/<market>"
                    value={heroInput}
                    onChange={(e) => { setHeroInput(e.target.value); setHeroError(null); }}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="paste a polymarket URL or press enter to sign in"
                  />
                </div>
                <button type="submit" className="mono" disabled={heroBusy}>
                  {heroBusy ? 'resolving…' : heroInput.trim() ? 'open market →' : 'sign in →'}
                </button>
              </form>
              {heroError && <div className="command-error mono">{heroError}</div>}
              <div className="hero-meta mono">
                <span>no order placement</span>
                <span>no wallet signing</span>
                <span>BYOK encrypted in browser</span>
              </div>
            </div>

            <aside className="preview" aria-label="market brief visual preview">
              <div className="preview-head">
                <div>
                  <div className="kicker mono">polymarket / politics</div>
                  <div className="title">Will J.D. Vance win the 2028 Republican presidential nomination?</div>
                </div>
                <button type="button" className="watch mono">watch</button>
              </div>
              <div className="price-grid mono">
                <div className="price-cell">
                  <div className="price-label">yes</div>
                  <div className="price-value yes">0.37</div>
                </div>
                <div className="price-cell">
                  <div className="price-label">no</div>
                  <div className="price-value no">0.63</div>
                </div>
                <div className="price-cell">
                  <div className="price-label">resolves in</div>
                  <div className="price-value">910d</div>
                </div>
                <div className="price-cell">
                  <div className="price-label">24h vol</div>
                  <div className="price-value">$57k</div>
                </div>
              </div>
              <div className="preview-grid">
                <div className="preview-panel">
                  <div className="panel-title mono"><span>market</span><span>top 20</span></div>
                  <div className="book-row mono"><span className="no">NO</span><span className="size">$4,317</span><span className="cum">$4,317</span></div>
                  <div className="book-row mono"><span className="no">NO</span><span className="size">$280</span><span className="cum">$4,598</span></div>
                  <div className="book-row mono"><span className="no">NO</span><span className="size">$129</span><span className="cum">$4,728</span></div>
                  <div className="book-row mono"><span className="yes">YES</span><span className="size">$3,920</span><span className="cum">$3,920</span></div>
                  <div className="book-row mono"><span className="yes">YES</span><span className="size">$514</span><span className="cum">$4,434</span></div>
                </div>
                <div className="preview-panel">
                  <div className="panel-title mono"><span>research</span><span>53 citations</span></div>
                  <div className="research-row mono"><span className="cite">news-1</span><span className="thesis">Vance enters 2025 as Trump's vice president and presumptive MAGA heir</span><span className="source">training</span></div>
                  <div className="research-row mono"><span className="cite">news-3</span><span className="thesis">Republican field remains unsettled this far from the primary</span><span className="source">training</span></div>
                  <div className="research-row mono"><span className="cite">comp-4</span><span className="thesis">Open primary comparables show late leader churn</span><span className="source">base rate</span></div>
                  <div className="research-row mono"><span className="cite">whale-2</span><span className="thesis">Top ten holders concentrate 90 percent of open interest</span><span className="source">holders</span></div>
                </div>
              </div>
              <div className="preview-foot mono">
                <div className="stat"><div className="k">book depth</div><div className="v">$78,774</div></div>
                <div className="stat"><div className="k">spread</div><div className="v">0.001</div></div>
                <div className="stat"><div className="k">top10 hold</div><div className="v warn">90%</div></div>
                <div className="stat"><div className="k">citations</div><div className="v brand">53</div></div>
                <div className="stat"><div className="k">agents</div><div className="v yes">5/6 done</div></div>
              </div>
            </aside>
          </section>

          {/* Band 02 — the four-step principle grid */}
          <section className="band">
            <div className="band-inner">
              <div className="band-head mono">
                <span>02</span>
                <span>after you paste a market</span>
                <span className="rule" />
                <span>live sources, then synthesis</span>
              </div>
              <div className="principles">
                <div className="principle">
                  <div className="num mono">01</div>
                  <div>
                    <h2>read the book</h2>
                    <p>mid, spread, depth, and slippage are pulled from the live CLOB before the brief starts writing.</p>
                  </div>
                </div>
                <div className="principle">
                  <div className="num mono">02</div>
                  <div>
                    <h2>map the holders</h2>
                    <p>top wallets, side bias, and concentration show whether the price is broad consensus or a crowded trade.</p>
                  </div>
                </div>
                <div className="principle">
                  <div className="num mono">03</div>
                  <div>
                    <h2>pull evidence</h2>
                    <p>news uses curated source lists. low-trust and user-editable domains stay banned by hostname.</p>
                  </div>
                </div>
                <div className="principle">
                  <div className="num mono">04</div>
                  <div>
                    <h2>cite or drop</h2>
                    <p>synthesis can only cite ids that upstream agents already emitted. invented citations get stripped.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Band 03 — the seven-agent board (6 small + 1 wide synthesis card) */}
          <section className="band">
            <div className="band-inner">
              <div className="band-head mono">
                <span>03</span>
                <span>seven agents</span>
                <span className="rule" />
                <span>one brief</span>
              </div>
              <div className="agent-board">
                {AGENTS.slice(0, 6).map(([idx, name, pill, desc]) => (
                  <div key={idx} className="agent-card">
                    <span className="agent-num mono">{idx}</span>
                    <h2>{name}</h2>
                    <p>{desc}</p>
                    <span className="agent-pill mono">{pill.replace(/[[\]]/g, '')}</span>
                  </div>
                ))}
                {AGENTS[6] && (
                  <div className="agent-card wide">
                    <span className="agent-num mono">{AGENTS[6][0]}</span>
                    <h2>{AGENTS[6][1]}</h2>
                    <p>{AGENTS[6][3]}</p>
                    <span className="agent-pill mono">{AGENTS[6][2].replace(/[[\]]/g, '').replace(/^∅\s*/, '')}</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Band 04 — final CTA, mirrors the hero command row */}
          <section className="band final-cta">
            <div className="band-inner final-grid">
              <div>
                <div className="band-head mono compact">
                  <span>04</span>
                  <span>read-only by design</span>
                  <span className="rule" />
                </div>
                <h2>research the trade. keep execution somewhere else.</h2>
                <p>
                  pmcopilot.wtf does not place orders, request spend permissions,
                  or ask you to sign wallet messages. bring your own keys for model
                  calls, inspect the evidence, and click any citation back to its row.
                </p>
              </div>
              <div className="cta-panel mono">
                <div className="domain">pmcopilot.wtf</div>
                <form className="cta-row-real" onSubmit={onSubmitHero}>
                  <span className="cta-prompt">&gt;</span>
                  <input
                    type="text"
                    className="cta-input mono"
                    placeholder="paste a polymarket url…"
                    value={heroInput}
                    onChange={(e) => { setHeroInput(e.target.value); setHeroError(null); }}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="paste a polymarket URL or press enter to sign in"
                  />
                  <button type="submit" disabled={heroBusy}>
                    {heroBusy ? 'resolving…' : heroInput.trim() ? 'open market →' : 'sign in →'}
                  </button>
                </form>
                <div className="cta-hint mono">
                  paste a market url to brief it · or leave blank and press enter to sign in
                </div>
                <div className="cta-checks">
                  <span>no orders</span>
                  <span>no signing</span>
                  <span>no fabricated sources</span>
                </div>
              </div>
            </div>
          </section>

          <footer className="land-footer">
            <div className="band-inner">
              <span>pmcopilot.wtf</span>
              <span>open source prediction market research desk</span>
            </div>
            <div className="band-inner land-footer-privacy mono">
              <span>
                we store your pasted wallet, optional X handle, and which markets
                you research so we can show how the product is used. no chat
                content is stored. see{' '}
                <a
                  href="https://github.com/Torque44/pm-copilot-oss/blob/main/docs/PRIVACY.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  privacy policy
                </a>.
              </span>
            </div>
          </footer>
        </main>
      </div>

      {/* ============== STAGE 2: wallet picker ============== */}
      <div className={`lf-stage lf-stage-auth ${stage === 'auth-paste' ? 'active' : ''}`}>
        <div className="lf-modal">
          <div className="lf-modal-head">
            <div className="auth-mini-logo">
              <div className="poly-mark">P</div>
              <span className="swap-arrow">↔</span>
              <img src="/mark.svg" alt="pm" className="auth-pm-logo" width={33} height={16} />
            </div>
            <div className="head-text">
              <div className="head-title">sign in to pmcopilot</div>
              <div className="head-sub mono">paste your wallet · read-only · no signing, no spending</div>
            </div>
            <button className="head-x" onClick={() => setStage('landing')} aria-label="close">✕</button>
          </div>

          <form className="lf-modal-body" onSubmit={onSubmitAddr}>
            <div className="modal-label mono">
              paste your polymarket wallet address (0x…) to read your positions
            </div>
            <div className="addr-row">
              <input
                type="text"
                className="addr-input mono"
                placeholder="0x…  or paste a polymarket.com URL to browse a market"
                value={addr}
                onChange={(e) => { setAddr(e.target.value); setAddrError(null); }}
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
              <button type="submit" className="addr-submit">continue ↵</button>
            </div>
            {addrError && <div className="addr-error mono">{addrError}</div>}
            <div className="addr-hint mono">
              we read positions for this wallet only. no signing, no spending,
              no permissions requested. <b>tradeable execution lands in v2 — this is v1.</b>
              <br />
              <span className="addr-hint-aside">or paste a polymarket market URL to browse the brief without signing in.</span>
            </div>
          </form>

          <div className="lf-modal-foot mono">
            <span className="lock">⊙</span>
            <span>read-only. no spend permissions requested.</span>
          </div>
        </div>
      </div>

      {/* ============== STAGE 3: twitter handoff ============== */}
      <div className={`lf-stage lf-stage-twitter ${stage === 'twitter' ? 'active' : ''}`}>
        <div className="twitter-card">
          <div className="progress mono">
            <span className="dot done" />
            <span>polymarket</span>
            <span className="step-name muted">·</span>
            <span className="dot active" />
            <span className="step-name">x / twitter</span>
            <span className="step-name muted">·</span>
            <span className="dot" />
            <span>desk</span>
          </div>

          <h2>one more, paste your X handle.</h2>

          <p className="why">
            the news and sentiment agents weight by <span className="accent">accounts you actually follow</span>.
            we read your follow graph <span className="accent">once</span>, then never again.
            skip if you don't trust us yet.
          </p>

          <form className="x-connect-row" onSubmit={onSubmitHandleForm}>
            <div className="handle-input-wrap">
              <span className="at">@</span>
              <input
                ref={handleInputRef}
                className="handle-input"
                placeholder="vitalikbuterin"
                autoComplete="off"
                spellCheck={false}
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
              <span
                className={`handle-check mono check-${handleCheck}`}
                aria-live="polite"
                title={
                  handleCheck === 'ok' ? 'handle exists on x.com' :
                  handleCheck === 'notfound' ? 'no such handle on x.com — check the spelling' :
                  handleCheck === 'checking' ? 'verifying…' :
                  handleCheck === 'unknown' ? "couldn't verify (x.com timed out) — proceed anyway if it's yours" :
                  ''
                }
              >
                {handleCheck === 'ok' && '✓'}
                {handleCheck === 'notfound' && '✕'}
                {handleCheck === 'checking' && '⋯'}
                {handleCheck === 'unknown' && '~'}
              </span>
              <button type="submit" className="handle-submit">continue ↵</button>
            </div>
          </form>

          <div className="privacy-note mono">
            <span className="cit-glyph">⊙</span>
            <span>
              <b>scopes:</b> read public profile, follows, lists. no posting, no DMs.
              revoke anytime from x settings.
            </span>
          </div>

          <div className="skip-row mono">
            <span>step 2 of 2</span>
            <button type="button" className="skip-link" onClick={onSkipHandle}>
              skip for now →
            </button>
          </div>
        </div>
      </div>

      {/* ============== STAGE 4: handoff loader ============== */}
      <div className={`lf-stage lf-stage-handoff ${stage === 'handoff' ? 'active' : ''}`}>
        <div className="handoff-card">
          <div className="ho-spinner" />
          <div className="ho-line mono">{hoLine}</div>
        </div>
      </div>
    </div>
  );
}
