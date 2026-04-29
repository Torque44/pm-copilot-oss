// VerdictBand + Chat — bottom of the workbench.

function VerdictBand() {
  return (
    <div className="verdict-band">
      <div className="verdict-text">signals split</div>
      <div className="verdict-sep" />
      <div className="verdict-stat">
        <div className="verdict-label mono">implied yield</div>
        <div className="verdict-value mono">+4.8%</div>
      </div>
      <div className="verdict-stat">
        <div className="verdict-label mono">days to resolve</div>
        <div className="verdict-value mono">14d 6h</div>
      </div>
      <div className="verdict-stat">
        <div className="verdict-label mono">book depth (yes)</div>
        <div className="verdict-value mono">$184k @ 0.62</div>
      </div>
      <div className="verdict-stat">
        <div className="verdict-label mono">spread</div>
        <div className="verdict-value mono">0.03</div>
      </div>
      <div className="verdict-stat">
        <div className="verdict-label mono">holders concentration</div>
        <div className="verdict-value mono">47.3% top10</div>
      </div>
    </div>
  );
}

function Chat() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={`chat ${open ? 'open' : ''}`}>
      {open ? (
        <div className="chat-expanded">
          <div className="chat-history">
            <div className="chat-msg user">how concentrated is the yes side?</div>
            <div className="chat-msg ai">
              top 10 yes holders hold 47.3% of yes-side oi <span className="cite-pill mono">[c-014]</span>; the top single wallet alone holds 12.4% <span className="cite-pill mono">[c-014]</span>. concentration is high relative to similar btc binary contracts.
            </div>
          </div>
          <div className="chat-input-row">
            <input className="chat-input" placeholder="ask about this market…" autoFocus onBlur={() => setOpen(false)} />
            <span className="kbd mono">⌘P pin</span>
            <span className="kbd mono">⌘L focus</span>
          </div>
        </div>
      ) : (
        <button className="chat-collapsed" onClick={() => setOpen(true)}>
          <span className="chat-prompt mono">›</span>
          <span className="chat-placeholder">ask about this market…</span>
          <span className="kbd mono">⌘L</span>
        </button>
      )}
    </div>
  );
}

window.VerdictBand = VerdictBand;
window.Chat = Chat;
