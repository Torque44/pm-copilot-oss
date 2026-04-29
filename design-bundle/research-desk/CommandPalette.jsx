// CommandPalette — ⌘K.

function CommandPalette({ open, onClose }) {
  if (!open) return null;
  const items = [
    { kbd: '⌘1', label: 'focus book panel' },
    { kbd: '⌘2', label: 'focus holders panel' },
    { kbd: '⌘3', label: 'focus news panel' },
    { kbd: '⌘4', label: 'focus thesis panel' },
    { kbd: '⌘[', label: 'toggle left rail' },
    { kbd: '⌘]', label: 'toggle right rail' },
    { kbd: '⌘D', label: 'compare mode' },
    { kbd: '⌘P', label: 'pin chat answer to verdict band' },
    { kbd: '⌘,', label: 'open settings' },
  ];
  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <input className="palette-input" placeholder="run command, search market, or paste url" autoFocus />
        <div className="palette-list">
          {items.map((c, i) => (
            <div key={i} className="palette-item">
              <span className="palette-label">{c.label}</span>
              <span className="palette-kbd mono">{c.kbd}</span>
            </div>
          ))}
        </div>
        <div className="palette-foot mono">esc to close · ↵ to run</div>
      </div>
    </div>
  );
}

function SettingsModal({ open, onClose }) {
  if (!open) return null;
  const [provider, setProvider] = React.useState('anthropic');
  const providers = ['anthropic', 'openai', 'gemini', 'perplexity'];
  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <header className="settings-head">
          <h2 className="settings-title">settings</h2>
          <button className="settings-close" onClick={onClose}>esc</button>
        </header>
        <section className="settings-section">
          <div className="settings-label mono">grounding provider</div>
          <div className="settings-providers">
            {providers.map(p => (
              <button key={p} className={`provider-pill ${p===provider?'active':''}`} onClick={() => setProvider(p)}>{p}</button>
            ))}
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-label mono">mcp servers</div>
          <table className="dense settings-table">
            <thead><tr><th>name</th><th>url</th><th>status</th></tr></thead>
            <tbody>
              <tr><td>polymarket-gamma</td><td className="mono muted">https://gamma-api.polymarket.com</td><td className="yes mono">connected</td></tr>
              <tr><td>kalshi-rest</td><td className="mono muted">https://trading-api.kalshi.com</td><td className="yes mono">connected</td></tr>
              <tr><td>etherscan</td><td className="mono muted">https://api.etherscan.io</td><td className="warn mono">rate-limited</td></tr>
              <tr><td>news-cache</td><td className="mono muted">file://.cache/news</td><td className="muted mono">disabled</td></tr>
            </tbody>
          </table>
        </section>
        <section className="settings-section">
          <div className="settings-label mono">theme</div>
          <div className="settings-providers">
            <button className="provider-pill active">dark</button>
            <button className="provider-pill">light <span className="mono muted" style={{marginLeft:6}}>experimental</span></button>
          </div>
        </section>
      </div>
    </div>
  );
}

window.CommandPalette = CommandPalette;
window.SettingsModal = SettingsModal;
