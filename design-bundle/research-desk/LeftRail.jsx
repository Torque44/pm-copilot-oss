// LeftRail — event rail (320px). sticky search + category tabs + nested outcome rows.

const CATEGORIES = ['crypto', 'sports', 'politics', 'other'];

const EVENTS = [
  { cat: 'crypto', name: 'btc at $100k by eoy 2026',         outcomes: [{ id: 'btc100k', name: 'YES', price: 0.62 }, { id: 'btc100k-no', name: 'NO', price: 0.39 }] },
  { cat: 'crypto', name: 'eth/btc ratio < 0.04 by jul 2026', outcomes: [{ id: 'ethbtc',   name: 'YES', price: 0.34 }, { id: 'ethbtc-no',  name: 'NO', price: 0.67 }] },
  { cat: 'crypto', name: 'sol > $400 in q3 2026',            outcomes: [{ id: 'sol400',   name: 'YES', price: 0.18 }, { id: 'sol400-no',  name: 'NO', price: 0.83 }] },
  { cat: 'politics', name: '2028 democratic nominee',        outcomes: [{ id: 'dem2028', name: 'newsom',   price: 0.21 }, { id: 'dem-pete', name: 'buttigieg', price: 0.14 }, { id: 'dem-gw', name: 'whitmer', price: 0.11 }] },
  { cat: 'politics', name: 'next fed rate decision',         outcomes: [{ id: 'fed-cut', name: '25bp cut', price: 0.71 }, { id: 'fed-hold', name: 'hold', price: 0.27 }] },
  { cat: 'sports', name: 'super bowl LX winner',             outcomes: [{ id: 'sb-kc',  name: 'kansas city', price: 0.22 }, { id: 'sb-buf', name: 'buffalo', price: 0.18 }] },
];

function LeftRail({ selectedId, onSelect, collapsed }) {
  const [cat, setCat] = React.useState('crypto');
  const [q, setQ] = React.useState('');

  if (collapsed) return null;

  const filtered = EVENTS.filter(e => e.cat === cat).filter(e => !q || e.name.includes(q.toLowerCase()));

  return (
    <aside className="rail-left">
      <div className="rail-sticky">
        <div className="search-box">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="search markets" value={q} onChange={e => setQ(e.target.value)} />
          <span className="kbd">⌘K</span>
        </div>
        <div className="cat-tabs">
          {CATEGORIES.map(c => (
            <button key={c} className={`cat-tab ${c === cat ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>
      <div className="event-list">
        {filtered.map((e, i) => (
          <div key={i} className="event-group">
            <div className="event-name">{e.name}</div>
            {e.outcomes.map(o => (
              <button
                key={o.id}
                className={`outcome-row ${o.id === selectedId ? 'selected' : ''}`}
                onClick={() => onSelect(o.id)}
              >
                <span className="outcome-name">{o.name}</span>
                <span className="outcome-price mono">{o.price.toFixed(2)}</span>
              </button>
            ))}
          </div>
        ))}
        {filtered.length === 0 && <div className="empty-rail">no markets match.</div>}
      </div>
    </aside>
  );
}

window.LeftRail = LeftRail;
