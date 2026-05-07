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

const TICKER_ITEMS = [
  { name: 'btc $100k eoy', price: '0.62', delta: '+0.04', dir: 'up' },
  { name: 'fed cuts in june', price: '0.31', delta: '-0.05', dir: 'down' },
  { name: 'spot eth etf h1', price: '0.81', delta: '+0.02', dir: 'up' },
  { name: 'recession by q4', price: '0.18', delta: '-0.01', dir: 'down' },
  { name: 'gpt-5 by dec', price: '0.44', delta: '+0.03', dir: 'up' },
  { name: 'iran deal by aug', price: '0.36', delta: '-0.05', dir: 'down' },
  { name: 'taiwan crisis 2026', price: '0.12', delta: '+0.01', dir: 'up' },
  { name: 'sora public release', price: '0.58', delta: '+0.07', dir: 'up' },
];

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
          <img src="/logo.svg" alt="pm" className="util-logo" width={40} height={20} />
          <span>copilot</span>
        </span>
        <span className="sep" />
        <span className="mono">research desk</span>
        <span className="right">
          <span className="live-dot" />
          markets live · v0.1
        </span>
      </div>

      {/* ticker tape — rolling horizontally */}
      <div className="lf-ticker">
        <div className="lf-ticker-track">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((it, i) => (
            <span key={i} className="lf-ticker-item mono">
              <span className="name">{it.name}</span>
              <span className="price">{it.price}</span>
              <span className={`delta ${it.dir}`}>{it.delta}</span>
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
              <img src="/logo.svg" alt="pm" className="auth-pm-logo" width={40} height={20} />
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
