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

type Stage = 'landing' | 'auth-wallets' | 'auth-paste' | 'twitter' | 'handoff';

// Minimal shape for EIP-1193 injected wallet providers (window.ethereum).
// Just enough to call eth_requestAccounts; we don't sign or send tx.
type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
};

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
const TICKER_CACHE_KEY = 'pm-copilot:ticker-cache:v3';
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
  const [walletPick, setWalletPick] = useState<string | null>(null);
  const [addr, setAddr] = useState('');
  const [addrError, setAddrError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
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
          const items: TickerItem[] = [];
          const maxLen = Math.max(...collected.map((l) => l.length), 0);
          for (let i = 0; i < maxLen && items.length < 16; i++) {
            for (const list of collected) {
              const ev = list[i];
              if (!ev) continue;
              const item = eventToTickerItem(ev);
              if (!item) continue;
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

  const onSubmitAddr = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = addr.trim();
    if (!isPlausibleEvmAddress(trimmed)) {
      setAddrError('that doesn\'t look like a valid 0x address.');
      return;
    }
    setAddrError(null);
    onConnectWallet(trimmed);
    setStage('twitter');
  };

  // Browser-injected wallet connect (MetaMask, Coinbase Wallet extension,
  // Rabby, OKX, Brave). All inject a window.ethereum provider. We don't
  // sign anything — just request the user's address with eth_requestAccounts.
  // No SDK, no extra deps; ~0KB bundle cost.
  const connectInjected = async (which: 'metamask' | 'coinbase' | 'walletconnect') => {
    setConnectError(null);
    if (which === 'walletconnect') {
      // WalletConnect QR flow needs an SDK we haven't bundled. Fall through
      // to the address-paste step which works for everyone — including
      // mobile-only users on the Polymarket app, who can copy their
      // address straight from their profile.
      setWalletPick('walletconnect');
      setStage('auth-paste');
      return;
    }
    const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    if (!eth || typeof eth.request !== 'function') {
      // No injected wallet available — fall back to paste with a helpful
      // hint. Common case on mobile browsers without the wallet extension.
      setConnectError(
        which === 'metamask'
          ? 'metamask not detected in this browser. install the extension or paste your address below.'
          : 'coinbase wallet extension not detected. install it or paste your address below.',
      );
      setWalletPick(which);
      setStage('auth-paste');
      return;
    }
    setConnecting(which);
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error('no account returned by wallet');
      }
      const first = accounts[0];
      if (typeof first !== 'string' || !isPlausibleEvmAddress(first)) {
        throw new Error('wallet returned an unexpected address shape');
      }
      onConnectWallet(first);
      setStage('twitter');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // User rejected the request (MetaMask code 4001) or any other error
      // — drop to paste with the message visible.
      setConnectError(`connect failed: ${msg.slice(0, 140)}. try pasting your address instead.`);
      setWalletPick(which);
      setStage('auth-paste');
    } finally {
      setConnecting(null);
    }
  };

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
      {/* utility bar — quiet status at the top */}
      <div className="lf-util-bar">
        <span className="brand-mini mono">
          <img src="/wordmark.svg" alt="pm copilot" className="util-logo" width={107} height={20} />
        </span>
        <span className="sep" />
        <span className="mono">research desk</span>
        <span className="right">
          <span className="live-dot" />
          markets live · v0.1
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

      {/* ============== STAGE 1: landing ============== */}
      <div className={`lf-stage lf-stage-landing ${stage === 'landing' ? 'active' : ''}`}>
        <main className="land">
          <section className="land-hero-band">
            <div className="land-marker mono">
              <span className="num">01</span>
              <span>research desk for polymarket</span>
              <span className="rule" />
              <span className="meta">v0.1 · early access · may 2026</span>
            </div>

            <h1 className="headline">
              the AI on most pm tools<br />
              <em>makes up</em> citations.<br />
              <span className="accent">this one</span> can't.
            </h1>

            <div className="lede-grid">
              <p className="lede-prose">
                paste any polymarket market or event url. seven specialists fan
                out in parallel: <b>orderbook depth</b>, <b>top wallet rotations</b>,
                <b> news from a curated allowlist</b> (wikipedia, medium, reddit,
                substack are banned by hostname because user-editable sources can
                be doctored mid-trade), <b>vetted X handles</b>, <b>resolved
                comparables</b> for base rates. each agent emits claims tagged
                with citation ids like <code>[whale-3]</code> or <code>[news-7]</code>.
                the synthesis layer can only cite ids the upstream agents
                actually emitted. invent one, the system drops it. <b>the
                contract is enforced in code, not by prompt instruction.</b>
              </p>

              <div className="lede-spec mono">
                <div className="lede-spec-row">
                  <span className="k">fan-out</span>
                  <span className="v">7 specialists <small>parallel</small></span>
                </div>
                <div className="lede-spec-row">
                  <span className="k">citations</span>
                  <span className="v">id-allowlisted <small>at synthesis</small></span>
                </div>
                <div className="lede-spec-row">
                  <span className="k">denylist</span>
                  <span className="v">wikipedia <small>+ medium + reddit + substack</small></span>
                </div>
                <div className="lede-spec-row">
                  <span className="k">read-only</span>
                  <span className="v">no signing <small>no spending</small></span>
                </div>
              </div>
            </div>

            <div className="cta-row">
              <button className="btn-primary" onClick={() => setStage('auth-wallets')}>
                sign in with polymarket
                <svg className="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75}>
                  <path d="M6 12 L10 8 L6 4" />
                </svg>
              </button>
              <span className="cta-helper mono">
                press <kbd>↵</kbd> to continue. BYOK keys live encrypted in your browser.
              </span>
            </div>
          </section>

          <section className="contract-band">
            <div className="contract-head mono">
              <span className="num">02</span>
              <span>the contract</span>
              <span className="rule" />
              <span className="meta">enforced in code, not by prompt</span>
            </div>
            <ol className="contract-steps">
              <li>
                <span className="step-num mono">01</span>
                <span className="step-body">
                  seven specialists fan out in parallel against real
                  data sources. one llm call per agent, never one llm
                  for the whole brief.
                </span>
              </li>
              <li>
                <span className="step-num mono">02</span>
                <span className="step-body">
                  each agent emits structured claims tagged with citation
                  ids it can prove: <code>[book-1a]</code>, <code>[whale-3]</code>,
                  <code> [news-7]</code>, <code>[kol-2]</code>, <code>[comp-4]</code>.
                </span>
              </li>
              <li>
                <span className="step-num mono">03</span>
                <span className="step-body">
                  synthesis merges the six and runs every cite id through
                  an allowlist of ids upstream agents actually produced.
                  unknown ids get stripped from text and citations array.
                </span>
              </li>
              <li>
                <span className="step-num mono">04</span>
                <span className="step-body">
                  the brief renders with cyan citation pills. click any
                  pill, the matching source row flashes in the rail in
                  under a second. answer to evidence in one keystroke.
                </span>
              </li>
            </ol>
          </section>

          <section className="manifest-band">
            <div className="manifest-head">
              <h2>seven agents,<br /><em>one brief</em>.</h2>
              <div className="sub">
                six specialists pull live data in parallel. a seventh merges
                them through the citation allowlist. each agent owns its own
                source, scope, and pill prefix.
              </div>
            </div>

            <div className="manifest-list">
              {AGENTS.map(([idx, name, pill, desc]) => (
                <div key={idx} className="manifest-row">
                  <span className="idx mono">{idx}</span>
                  <span className="name mono">{name}</span>
                  <span className="pill mono">{pill}</span>
                  <span className="desc">{desc}</span>
                </div>
              ))}
            </div>
          </section>

          <footer className="land-foot mono">
            <div>© 2026 pm copilot. <b>not financial advice.</b></div>
            <div>built in mono</div>
            <div className="right">open source</div>
          </footer>
        </main>
      </div>

      {/* ============== STAGE 2: wallet picker ============== */}
      <div className={`lf-stage lf-stage-auth ${stage === 'auth-wallets' || stage === 'auth-paste' ? 'active' : ''}`}>
        <div className="lf-modal">
          <div className="lf-modal-head">
            <div className="auth-mini-logo">
              <div className="poly-mark">P</div>
              <span className="swap-arrow">↔</span>
              <img src="/mark.svg" alt="pm" className="auth-pm-logo" width={33} height={16} />
            </div>
            <div className="head-text">
              <div className="head-title">connect your wallet</div>
              <div className="head-sub mono">read-only. no signing, no spending.</div>
            </div>
            <button className="head-x" onClick={() => setStage('landing')} aria-label="close">✕</button>
          </div>

          {stage === 'auth-wallets' && (
            <div className="lf-modal-body">
              <div className="modal-label mono">choose a wallet</div>
              <div className="wallet-list">
                <button
                  type="button"
                  className="wallet-row"
                  onClick={() => { void connectInjected('metamask'); }}
                  disabled={connecting !== null}
                >
                  <div className="wico mm">M</div>
                  <div className="wname">
                    <div className="n">MetaMask</div>
                    <div className="s mono">browser extension. most polymarket users.</div>
                  </div>
                  <span className="wstatus">
                    {connecting === 'metamask' ? 'connecting…' : 'connect'}
                  </span>
                </button>
                <button
                  type="button"
                  className="wallet-row"
                  onClick={() => { void connectInjected('walletconnect'); }}
                  disabled={connecting !== null}
                >
                  <div className="wico wc">W</div>
                  <div className="wname">
                    <div className="n">WalletConnect</div>
                    <div className="s mono">paste address from your mobile wallet</div>
                  </div>
                  <span className="wstatus">paste</span>
                </button>
                <button
                  type="button"
                  className="wallet-row"
                  onClick={() => { void connectInjected('coinbase'); }}
                  disabled={connecting !== null}
                >
                  <div className="wico cb">C</div>
                  <div className="wname">
                    <div className="n">Coinbase Wallet</div>
                    <div className="s mono">extension. injects into the same path as metamask.</div>
                  </div>
                  <span className="wstatus">
                    {connecting === 'coinbase' ? 'connecting…' : 'connect'}
                  </span>
                </button>
              </div>
              {connectError && (
                <div className="addr-error mono" style={{ marginTop: 12 }}>{connectError}</div>
              )}
            </div>
          )}

          {stage === 'auth-paste' && (
            <form className="lf-modal-body" onSubmit={onSubmitAddr}>
              <div className="modal-label mono">
                paste your {walletPick === 'metamask' ? 'metamask' : walletPick === 'coinbase' ? 'coinbase' : 'wallet'} address
              </div>
              {connectError && (
                <div className="addr-error mono" style={{ marginBottom: 8 }}>{connectError}</div>
              )}
              <div className="addr-row">
                <input
                  type="text"
                  className="addr-input mono"
                  placeholder="0x…"
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
                we read your polymarket positions read-only. no signing, no spending,
                no permissions requested.
              </div>
              <button type="button" className="addr-back mono" onClick={() => { setConnectError(null); setStage('auth-wallets'); }}>
                ← pick a different wallet
              </button>
            </form>
          )}

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

          <h2>one more, link your X handle.</h2>

          <p className="why">
            the news and sentiment agents weight by <span className="accent">accounts you actually follow</span>.
            we read your follow graph <span className="accent">once</span>, then never again.
            skip if you don't trust us yet.
          </p>

          <form className="x-connect-row" onSubmit={onSubmitHandleForm}>
            <button type="button" className="btn-x" onClick={() => handleInputRef.current?.focus()}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              connect with X
            </button>

            <div className="or-divider mono">or paste a handle</div>

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
