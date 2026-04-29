// EmptyState, CompareMode, MobileFallback wrappers + LoadingToast.

function EmptyState() {
  const recents = [
    { name: 'btc at $100k by eoy 2026', meta: '0.62 yes · 14d 6h', cat: 'crypto' },
    { name: '2028 dem nominee · newsom', meta: '0.21 yes · ~30 mo', cat: 'politics' },
    { name: 'fed 25bp cut next meet', meta: '0.71 yes · 19d', cat: 'politics' },
    { name: 'super bowl LX · kc', meta: '0.22 yes · 9 mo', cat: 'sports' },
    { name: 'eth/btc < 0.04 by jul', meta: '0.34 yes · 2 mo', cat: 'crypto' },
    { name: 'cpi print < 2.5% jun', meta: '0.46 yes · 47d', cat: 'politics' },
  ];
  return (
    <div className="empty-state">
      <div className="empty-card">
        <div className="empty-title">no market selected</div>
        <div className="empty-sub">pick a market on the left, or paste a polymarket / kalshi url.</div>
        <input className="empty-paste" placeholder="https://polymarket.com/event/…" />
      </div>
      <div className="empty-recents">
        <div className="empty-recents-title mono">recently viewed</div>
        <div className="empty-recents-grid">
          {recents.map((r, i) => (
            <button key={i} className="recent-card">
              <span className="recent-cat mono">{r.cat}</span>
              <span className="recent-name">{r.name}</span>
              <span className="recent-meta mono">{r.meta}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoadingToast() {
  return (
    <div className="loading-toast">
      <span className="dot running" /> <span className="mono">fetching grounding…</span>
    </div>
  );
}

function CompareHeader({ market }) {
  return (
    <div className="compare-header">
      <span className="venue-chip mono">{market.venue}</span>
      <h2 className="compare-title">{market.title}</h2>
      {!market.multi && (
        <div className="mh-prices">
          <div className="mh-price-block"><span className="mh-side mono">YES</span><span className="mh-price mono yes" style={{fontSize:18}}>{market.yes.toFixed(2)}</span></div>
          <div className="mh-price-block"><span className="mh-side mono">NO</span><span className="mh-price mono no" style={{fontSize:18}}>{market.no.toFixed(2)}</span></div>
        </div>
      )}
      <span className="mono muted" style={{marginLeft:'auto'}}>{market.resolveIn}</span>
    </div>
  );
}

function CompareMode({ a, b, onFlash, flashId }) {
  return (
    <div className="compare-grid">
      <div className="compare-col">
        <CompareHeader market={a} />
        <window.EvidenceGrid focusedPanel={null} onFocus={()=>{}} onFlash={onFlash} flashId={flashId} />
        <window.VerdictBand />
      </div>
      <div className="compare-divider" />
      <div className="compare-col">
        <CompareHeader market={b} />
        <window.EvidenceGrid focusedPanel={null} onFocus={()=>{}} onFlash={onFlash} flashId={flashId} />
        <div className="verdict-band">
          <div className="verdict-text" style={{color:'#10B981',background:'rgba(16,185,129,0.12)'}}>signals YES</div>
          <div className="verdict-sep" />
          <div className="verdict-stat"><div className="verdict-label mono">implied yield</div><div className="verdict-value mono">+11.2%</div></div>
          <div className="verdict-stat"><div className="verdict-label mono">days to resolve</div><div className="verdict-value mono">19d</div></div>
          <div className="verdict-stat"><div className="verdict-label mono">spread</div><div className="verdict-value mono">0.02</div></div>
        </div>
      </div>
    </div>
  );
}

function MobileFallback() {
  return (
    <div className="mobile-fallback">
      <header className="mobile-head">
        <span className="venue-chip mono">polymarket</span>
        <span className="mobile-title">btc at $100k by eoy 2026</span>
      </header>
      <div className="mobile-prices">
        <div><span className="mh-side mono">YES</span><span className="mh-price mono yes">0.62</span></div>
        <div><span className="mh-side mono">NO</span><span className="mh-price mono no">0.39</span></div>
        <div><span className="mh-side mono">resolves</span><span className="mh-price mono" style={{fontSize:16}}>14d 6h</span></div>
      </div>
      <div className="mobile-section">
        <div className="mobile-section-title mono">verdict</div>
        <div className="verdict-text" style={{display:'inline-block'}}>signals split</div>
      </div>
      <div className="mobile-section">
        <div className="mobile-section-title mono">key signals</div>
        <ul className="mobile-list">
          <li><span className="cite-pill mono">[c-014]</span> top 10 holders concentrated 47.3% on yes</li>
          <li><span className="cite-pill mono">[c-005]</span> book thin above 0.65</li>
          <li><span className="cite-pill mono">[c-022]</span> btc consolidates near $96k as etf flows turn flat</li>
          <li><span className="cite-pill mono">[c-025]</span> spot etf cumulative net inflows breach $42b</li>
        </ul>
      </div>
      <div className="mobile-foot mono">desktop is the home. view-only on mobile.</div>
    </div>
  );
}

window.EmptyState = EmptyState;
window.LoadingToast = LoadingToast;
window.CompareMode = CompareMode;
window.MobileFallback = MobileFallback;
