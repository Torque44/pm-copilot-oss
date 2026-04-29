// Chat — sticky bottom chat. Collapsed pill -> expanded input + history.

import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { ChatMessage } from '../../types';

export interface ChatProps {
  messages?: ChatMessage[];
  onSend?: (text: string) => void;
  busy?: boolean;
}

export function Chat({ messages, onSend, busy = false }: ChatProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const history = messages ?? [];

  const send = () => {
    const v = text.trim();
    if (!v) return;
    onSend?.(v);
    setText('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={`chat ${open ? 'open' : ''}`}>
      {open ? (
        <div className="chat-expanded">
          <div className="chat-history">
            {history.length === 0 && (
              <div className="chat-msg ai chat-empty">
                ask about book depth, holders concentration, or recent catalysts.
              </div>
            )}
            {history.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                {m.content}
                {m.citations?.map((c, j) => (
                  <span key={j} className="cite-pill mono">
                    [{c}]
                  </span>
                ))}
              </div>
            ))}
            {busy && <div className="chat-msg ai chat-typing">…</div>}
          </div>
          <div className="chat-input-row">
            <input
              className="chat-input"
              placeholder={busy ? 'thinking…' : 'ask about this market…'}
              autoFocus
              value={text}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
              onKeyDown={onKey}
              onBlur={() => {
                if (!text) setOpen(false);
              }}
              disabled={busy}
            />
            <span className="kbd mono">enter</span>
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
