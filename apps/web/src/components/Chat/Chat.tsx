// Chat — single persistent input bar at the bottom of the workbench.
// History (if any) renders ABOVE the input; the input itself is always
// visible and always interactive. No collapsed/expanded states.
//
// AI messages now render as a STRUCTURED BRIEF (numbers / holders /
// catalysts / sentiment / thesis-yes / thesis-no), not one giant blob.
// The ask agent emits one claim per section, each prefixed with a markdown
// `**Section:**` label. We split on \n\n and render each block with its
// own styled header + the citation pills it actually references.

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactElement } from 'react';
import type { ChatMessage } from '../../types';

export interface ChatProps {
  messages?: ChatMessage[];
  onSend?: (text: string) => void;
  busy?: boolean;
}

// ---- markdown-lite section renderer ----
// We don't want a full markdown parser; just enough to pull a leading
// `**Header:** body` out of each paragraph and to render `[cite-id]` tokens
// as clickable pills inline with the text.

type Block = { header: string | null; body: string; citations: string[] };

const SECTION_RX = /^\*\*([^*]+?):\*\*\s*/; // e.g. "**Thesis (YES):** "
const CITE_RX = /\[([a-z0-9]+(?:[·-][a-z0-9]+)*)\]/gi;

function parseBlocks(content: string): Block[] {
  if (!content) return [];
  const paras = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) return [];
  return paras.map((para): Block => {
    const m = para.match(SECTION_RX);
    let header: string | null = null;
    let body = para;
    if (m) {
      header = m[1]!.trim();
      body = para.slice(m[0].length);
    }
    const cites: string[] = [];
    let cm: RegExpExecArray | null;
    CITE_RX.lastIndex = 0;
    while ((cm = CITE_RX.exec(body)) !== null) {
      const id = cm[1]!.toLowerCase();
      if (!cites.includes(id)) cites.push(id);
    }
    return { header, body, citations: cites };
  });
}

// Render the body with `[cite-id]` tokens inlined as pill spans. Returns a
// flat array of (string | element) so React can render mixed content.
//
// `validIds` (when supplied) gates pill rendering: only ids that exist in
// the message's validated citation set become pills; unrecognized ids are
// rendered as plain text. Server-side scrubbing already strips fake pills
// from claim text, but this client-side guard catches anything that slips
// through (cached pre-fix responses, future agent shapes, etc).
function renderBody(body: string, key: string, validIds?: Set<string>): Array<string | ReactElement> {
  const out: Array<string | ReactElement> = [];
  CITE_RX.lastIndex = 0;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = CITE_RX.exec(body)) !== null) {
    if (m.index > lastIdx) out.push(body.slice(lastIdx, m.index));
    const id = m[1]!.toLowerCase();
    const isValid = !validIds || validIds.has(id);
    if (isValid) {
      out.push(
        <span key={`${key}-cite-${n}`} className="cite-pill mono inline">
          [{id}]
        </span>,
      );
    } else {
      // Unknown id — render the original bracketed text as plain prose so
      // the reader still sees what the model wrote, but no pill renders.
      out.push(m[0]);
    }
    lastIdx = m.index + m[0].length;
    n += 1;
  }
  if (lastIdx < body.length) out.push(body.slice(lastIdx));
  return out;
}

function headerClass(header: string | null): string {
  if (!header) return 'chat-section';
  const h = header.toLowerCase();
  if (h.startsWith('thesis (yes)')) return 'chat-section thesis-yes';
  if (h.startsWith('thesis (no)')) return 'chat-section thesis-no';
  if (h.startsWith('thesis')) return 'chat-section thesis';
  if (h.startsWith('numbers')) return 'chat-section numbers';
  if (h.startsWith('holders')) return 'chat-section holders';
  if (h.startsWith('catalysts')) return 'chat-section catalysts';
  if (h.startsWith('sentiment')) return 'chat-section sentiment';
  return 'chat-section';
}

export function Chat({ messages, onSend, busy = false }: ChatProps) {
  const [text, setText] = useState('');
  const history = messages ?? [];
  const historyRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll history to the bottom whenever the latest message grows
  // (streaming progress) or a new message arrives. Tracking only
  // `history.length` missed in-place updates from the SSE stream — once the
  // AI message landed we never re-scrolled, so the bottom of long sectioned
  // answers was hidden under the fold. Hashing on length + last content
  // length is cheap and catches both cases. Use rAF so the DOM has painted
  // the new content before we measure scrollHeight.
  const lastLen = history.length;
  const lastContentLen = history[lastLen - 1]?.content.length ?? 0;
  useEffect(() => {
    const el = historyRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [lastLen, lastContentLen, busy]);

  const send = () => {
    if (busy) return;
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
          {history.map((m, i) => {
            // User messages stay simple (single line).
            if (m.role !== 'ai') {
              return (
                <div key={i} className={`chat-msg ${m.role}`}>
                  {m.content}
                </div>
              );
            }
            // AI message: split into sections. If only one block + no header,
            // fall back to flat rendering so error messages / fallbacks
            // ("Answer unavailable: …") don't get an awkward empty header.
            const blocks = parseBlocks(m.content);
            const flat = blocks.length <= 1 && (!blocks[0] || !blocks[0].header);
            // Validated pill ids for THIS message — server-stamped citations
            // array. renderBody gates pill rendering against this set so an
            // LLM-hallucinated [news-999] in the prose can never render as
            // an authoritative-looking pill on the client.
            const validIds = new Set((m.citations ?? []).map((c) => c.toLowerCase()));
            if (flat) {
              return (
                <div key={i} className="chat-msg ai">
                  <div className="chat-flat">
                    {renderBody(m.content, `${i}-flat`, validIds)}
                  </div>
                  {m.citations && m.citations.length > 0 && (
                    <div className="chat-cite-row">
                      {m.citations.map((c, j) => (
                        <span key={j} className="cite-pill mono">[{c}]</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <div key={i} className="chat-msg ai chat-msg-structured">
                {blocks.map((b, j) => (
                  <div key={j} className={headerClass(b.header)}>
                    {b.header && (
                      <div className="chat-section-head mono">{b.header}</div>
                    )}
                    <div className="chat-section-body">
                      {renderBody(b.body, `${i}-${j}`, validIds)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          {busy && <div className="chat-msg ai chat-typing">…</div>}
        </div>
      )}
      <div className="chat-input-row">
        {/* Input stays interactive while the previous answer streams — users
            can draft / edit a follow-up. Only the send button is gated on
            !busy so a question can't actually fire mid-stream. */}
        <input
          className="chat-input"
          placeholder={busy ? 'drafting next question while answer streams…' : 'ask about this market…'}
          value={text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <button
          type="button"
          className="chat-send"
          onClick={send}
          disabled={busy || !text.trim()}
          aria-label={busy ? 'waiting for current answer to finish' : 'send'}
          title={busy ? 'finish current answer first' : 'send (enter)'}
        >
          ↵
        </button>
      </div>
    </div>
  );
}
