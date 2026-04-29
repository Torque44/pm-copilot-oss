// EvidenceGrid — 2x2 panels: book / holders / news / thesis.
// each panel is a focus target for ⌘1-4. clicking a citation pill flashes the matching source row.

function Panel({ title, sub, focused, errored, loading, children, panelKey, onFocus }) {
  return (
    <section className={`panel ${focused ? 'focused' : ''} ${errored ? 'errored' : ''}`} onClick={() => onFocus(panelKey)}>
      <header className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="panel-sub mono">{sub}</span>
        <span className="panel-kbd mono">⌘{ {book:1, holders:2, news:3, thesis:4}[panelKey] }</span>
      </header>
      <div className="panel-body">
        {errored ? (
          <div className="panel-error">
            <div className="panel-error-head">polymarket gamma-api timeout</div>
            <div className="panel-error-body">no response in 8000ms. <a className="link">retry</a> · <a className="link">switch provider</a></div>
          </div>
        ) : loading ? (
          <div className="skeleton">
            <div className="skel-row" /><div className="skel-row" /><div className="skel-row" /><div className="skel-row" />
          </div>
        ) : children}
      </div>
    </section>
  );
}

function CitePill({ id, onFlash }) {
  return <span className="cite-pill mono" onClick={(e) => { e.stopPropagation(); onFlash(id); }}>[{id}]</span>;
}

function BookPanel({ flashId, onFlash }) {
  return (
    <table className="dense">
      <thead><tr><th>side</th><th className="num">price</th><th className="num">size</th><th className="num">cum</th></tr></thead>
      <tbody>
        <tr id="src-c-001" className={flashId==='c-001'?'flash':''}><td className="no">NO</td><td className="num mono">0.41</td><td className="num mono">$ 12,400</td><td className="num mono">$ 12,400</td></tr>
        <tr id="src-c-002" className={flashId==='c-002'?'flash':''}><td className="no">NO</td><td className="num mono">0.40</td><td className="num mono">$ 38,100</td><td className="num mono">$ 50,500</td></tr>
        <tr className="spread-row"><td colSpan="4" className="mono">— spread 0.03 —</td></tr>
        <tr id="src-c-003" className={flashId==='c-003'?'flash':''}><td className="yes">YES</td><td className="num mono">0.62</td><td className="num mono">$ 84,700</td><td className="num mono">$ 84,700</td></tr>
        <tr id="src-c-004" className={flashId==='c-004'?'flash':''}><td className="yes">YES</td><td className="num mono">0.61</td><td className="num mono">$ 22,300</td><td className="num mono">$107,000</td></tr>
        <tr id="src-c-005" className={flashId==='c-005'?'flash':''}><td className="yes">YES</td><td className="num mono">0.58</td><td className="num mono">$  4,900</td><td className="num mono">$111,900</td></tr>
      </tbody>
    </table>
  );
}

function HoldersPanel({ flashId, onFlash }) {
  return (
    <table className="dense">
      <thead><tr><th>#</th><th>address</th><th>side</th><th className="num">size</th><th className="num">% yes</th></tr></thead>
      <tbody>
        <tr id="src-c-014" className={flashId==='c-014'?'flash':''}><td className="mono">01</td><td className="mono muted">0xABCD…1234</td><td className="yes">YES</td><td className="num mono">$184,200</td><td className="num mono">12.4%</td></tr>
        <tr id="src-c-015" className={flashId==='c-015'?'flash':''}><td className="mono">02</td><td className="mono muted">0x9F12…77AE</td><td className="yes">YES</td><td className="num mono">$132,800</td><td className="num mono">8.9%</td></tr>
        <tr id="src-c-016" className={flashId==='c-016'?'flash':''}><td className="mono">03</td><td className="mono muted">0x44E2…0BC1</td><td className="no">NO</td><td className="num mono">$ 98,400</td><td className="num mono">—</td></tr>
        <tr id="src-c-017" className={flashId==='c-017'?'flash':''}><td className="mono">04</td><td className="mono muted">0x31AA…FF02</td><td className="yes">YES</td><td className="num mono">$ 71,300</td><td className="num mono">4.8%</td></tr>
        <tr id="src-c-018" className={flashId==='c-018'?'flash':''}><td className="mono">05</td><td className="mono muted">0x7E33…8821</td><td className="yes">YES</td><td className="num mono">$ 64,100</td><td className="num mono">4.3%</td></tr>
        <tr id="src-c-019" className={flashId==='c-019'?'flash':''}><td className="mono">06</td><td className="mono muted">0xC901…A12F</td><td className="no">NO</td><td className="num mono">$ 52,800</td><td className="num mono">—</td></tr>
      </tbody>
    </table>
  );
}

function NewsPanel({ flashId }) {
  const items = [
    { id: 'c-022', t: 'btc consolidates near $96k as etf flows turn flat', src: 'reuters.com', when: '3h ago' },
    { id: 'c-023', t: 'fed minutes show divided committee on cut timing',  src: 'wsj.com',     when: '6h ago' },
    { id: 'c-024', t: 'mt gox creditor distribution paused — bitstamp ack', src: 'theblock.co', when: '14h ago' },
    { id: 'c-025', t: 'spot etf cumulative net inflows breach $42b mark',  src: 'bloomberg.com', when: '1d ago' },
    { id: 'c-026', t: 'binance lists btc-quanto perp w/ 1d settle',         src: 'binance.com', when: '2d ago' },
  ];
  return (
    <ul className="news-list">
      {items.map(n => (
        <li key={n.id} id={`src-${n.id}`} className={`news-row ${flashId===n.id?'flash':''}`}>
          <span className="cite-id mono">[{n.id}]</span>
          <span className="news-title">{n.t}</span>
          <span className="news-meta mono">{n.src} · {n.when}</span>
        </li>
      ))}
    </ul>
  );
}

function ThesisPanel({ onFlash }) {
  return (
    <ul className="thesis-tree">
      <li className="thesis-node">
        <span className="thesis-label">btc reaches $100k by eoy 2026</span>
        <ul>
          <li className="thesis-node up">
            <span className="thesis-tag mono yes">SUPPORTS</span>
            <span className="thesis-label">spot etf flows positive ttm <CitePill id="c-025" onFlash={onFlash}/></span>
          </li>
          <li className="thesis-node up">
            <span className="thesis-tag mono yes">SUPPORTS</span>
            <span className="thesis-label">top 10 holders concentrated 47% yes <CitePill id="c-014" onFlash={onFlash}/></span>
          </li>
          <li className="thesis-node down">
            <span className="thesis-tag mono no">CHALLENGES</span>
            <span className="thesis-label">consolidation near $96k for 4w <CitePill id="c-022" onFlash={onFlash}/></span>
          </li>
          <li className="thesis-node down">
            <span className="thesis-tag mono no">CHALLENGES</span>
            <span className="thesis-label">book thin above 0.65 <CitePill id="c-005" onFlash={onFlash}/></span>
          </li>
        </ul>
      </li>
    </ul>
  );
}

function EvidenceGrid({ focusedPanel, onFocus, onFlash, flashId, errorPanel, loading }) {
  return (
    <div className={`evidence-grid focus-${focusedPanel || 'none'}`}>
      <Panel title="book" sub="28 levels · 3m ago" panelKey="book"
             focused={focusedPanel==='book'} errored={errorPanel==='book'} loading={loading}
             onFocus={onFocus}>
        <BookPanel flashId={flashId} onFlash={onFlash} />
      </Panel>
      <Panel title="holders" sub="top 250 · 5m ago" panelKey="holders"
             focused={focusedPanel==='holders'} errored={errorPanel==='holders'} loading={loading}
             onFocus={onFocus}>
        <HoldersPanel flashId={flashId} onFlash={onFlash} />
      </Panel>
      <Panel title="news" sub="dated · 6 sources" panelKey="news"
             focused={focusedPanel==='news'} errored={errorPanel==='news'} loading={loading}
             onFocus={onFocus}>
        <NewsPanel flashId={flashId} />
      </Panel>
      <Panel title="thesis" sub="4 nodes · 2 supports · 2 challenges" panelKey="thesis"
             focused={focusedPanel==='thesis'} errored={errorPanel==='thesis'} loading={loading}
             onFocus={onFocus}>
        <ThesisPanel onFlash={onFlash} />
      </Panel>
    </div>
  );
}

window.EvidenceGrid = EvidenceGrid;
window.CitePill = CitePill;
