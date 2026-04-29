// RightRail — context rail (280px). watchlist + recently-viewed + 7-dot agent status.
const RIGHT_WATCHLIST = [
  { name: 'btc at $100k by eoy 2026', price: 0.62, delta: '+0.04' },
  { name: 'fed 25bp cut',             price: 0.71, delta: '-0.02' },
  { name: 'eth/btc < 0.04',           price: 0.34, delta: '+0.01' },
  { name: '2028 dem nominee · newsom',price: 0.21, delta: '+0.03' },
];

const RIGHT_RECENT = [
  'sol > $400 q3',
  'super bowl LX · kc',
  'cpi print < 2.5% jun',
  'sec etf approval h2',
];

function AgentDots({ states }) {
  // states: array of 7, one of: pending | running | done | error
  return (
    <div className="agent-dots">
      <span className="agent-label mono">agents</span>
      {window.AGENTS.map((a, i) => (
        <span key={a.key} className={`dot ${states[i] || 'pending'}`} title={`${a.label} · ${states[i] || 'pending'}`} />
      ))}
    </div>
  );
}

function RightRail({ collapsed, agentStates }) {
  if (collapsed) return null;

  return (
    <aside className="rail-right">
      <div className="rail-section">
        <div className="rail-section-title">agents</div>
        <AgentDots states={agentStates} />
        <div className="agent-legend mono">
          <span><span className="dot pending"/> pending</span>
          <span><span className="dot running"/> running</span>
          <span><span className="dot done"/> done</span>
          <span><span className="dot error"/> error</span>
        </div>
      </div>

      <div className="rail-section">
        <div className="rail-section-title">watchlist</div>
        {RIGHT_WATCHLIST.map((w, i) => (
          <div key={i} className="watch-row">
            <div className="watch-name">{w.name}</div>
            <div className="watch-meta">
              <span className="mono">{w.price.toFixed(2)}</span>
              <span className={`mono delta ${w.delta.startsWith('+') ? 'up' : 'down'}`}>{w.delta}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rail-section">
        <div className="rail-section-title">recently viewed</div>
        {RIGHT_RECENT.map((r, i) => (
          <div key={i} className="recent-row">{r}</div>
        ))}
      </div>
    </aside>
  );
}

window.RightRail = RightRail;
window.AgentDots = AgentDots;
