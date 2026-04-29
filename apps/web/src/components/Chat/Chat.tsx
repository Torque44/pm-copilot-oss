// Chat — single persistent input bar at the bottom of the workbench.
// History (if any) renders ABOVE the input; the input itself is always
// visible and always interactive. No collapsed/expanded states.

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { ChatMessage } from '../../types';

export interface ChatProps {
  messages?: ChatMessage[];
  onSend?: (text: string) => void;
  busy?: boolean;
}

export function Chat({ messages, onSend, busy = false }: ChatProps) {
  const [text, setText] = useState('');
  const history = messages ?? [];
  const historyRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll history to the bottom when new messages or progress streams in.
  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length, busy]);

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

  const showHistory = history.length > 0 || busy;

  return (
    <div className="chat">
      {showHistory && (
        <div className="chat-history" ref={historyRef}>
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
      )}
      <div className="chat-input-row">
        <input
          className="chat-input"
          placeholder={busy ? 'thinking…' : 'ask about this market…'}
          value={text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={busy}
        />
        <button
          type="button"
          className="chat-send"
          onClick={send}
          disabled={busy || !text.trim()}
          aria-label="send"
        >
          ↵
        </button>
      </div>
    </div>
  );
}
