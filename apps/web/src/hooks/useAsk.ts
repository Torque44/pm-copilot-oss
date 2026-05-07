// useAsk — POST /api/ask with the loaded market + a question, then read the
// SSE response via fetch + ReadableStream (because the server requires the
// market in the request body, EventSource can't reach it).
//
// Persistence: chat history is stored in localStorage, keyed per marketId, so
// the user's questions + answers survive a page refresh and switching back to
// the same market restores the prior conversation. Stored messages are capped
// at MAX_STORED to keep localStorage well below the per-origin quota even for
// power users who run many markets.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/client';
import type { ChatMessage } from '../types';

const STORAGE_PREFIX = 'pm-copilot:chat:';
const MAX_STORED = 50;

function getMarketId(market: unknown): string | null {
  if (!market || typeof market !== 'object') return null;
  const raw = (market as { marketId?: unknown }).marketId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function loadFromStorage(marketId: string | null): ChatMessage[] {
  if (!marketId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${marketId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is ChatMessage => {
      return !!m && typeof m === 'object'
        && (m as ChatMessage).role !== undefined
        && typeof (m as ChatMessage).content === 'string';
    });
  } catch {
    return [];
  }
}

function saveToStorage(marketId: string | null, messages: ChatMessage[]): void {
  if (!marketId || typeof window === 'undefined') return;
  try {
    const trimmed = messages.length > MAX_STORED ? messages.slice(-MAX_STORED) : messages;
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${marketId}`,
      JSON.stringify(trimmed),
    );
  } catch {
    // Quota exceeded or storage disabled — fail silently. The in-memory copy
    // is still good for the current session; the user just loses persistence.
  }
}

type AskAnswer = {
  claims: { text: string; citations: string[] }[];
  citations: { id: string; kind: string; label?: string; url?: string }[];
};

type AskEvent =
  | { t: 'ask:start' }
  | { t: 'ask:progress'; message: string }
  | { t: 'ask:done'; answer: AskAnswer; elapsedMs: number }
  | { t: 'ask:error'; error: string; elapsedMs: number };

export type AskRunStatus = 'idle' | 'running' | 'done' | 'error';

export type UseAskResult = {
  messages: ChatMessage[];
  send: (text: string) => Promise<void>;
  busy: boolean;
  error: string | null;
  /** Wipe the chat history for the currently-loaded market. */
  clear: () => void;
  /** Lifecycle status of the most recent ask run. The right rail uses this
   *  to override the brief's static "ask: queued" state with live progress. */
  runStatus: AskRunStatus;
  /** Wall-clock ms since the current run started; null when idle. Updates
   *  every 250ms while running so the rail can show a live counter. */
  runElapsedMs: number | null;
  /** Final elapsed ms of the most recent completed run. Persists across
   *  the next idle period so the rail can show "DONE · 4.2s" after the
   *  answer lands, mirroring the brief-pipeline rows. */
  lastElapsedMs: number | null;
};

/**
 * The market argument is whatever shape the server's /api/ask `parseMarket`
 * expects: an object with marketId, tokenIdYes, tokenIdNo, and the rest of
 * MarketMeta. The hook does no validation — server returns 400 if invalid.
 */
export function useAsk(market: unknown): UseAskResult {
  const marketId = getMarketId(market);
  // Hydrate synchronously from localStorage so the first paint already shows
  // prior messages — no flicker between empty-state and restored.
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadFromStorage(marketId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<AskRunStatus>('idle');
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runElapsedMs, setRunElapsedMs] = useState<number | null>(null);
  const [lastElapsedMs, setLastElapsedMs] = useState<number | null>(null);

  // Live ticker while a run is in flight. We don't use Date.now() inside
  // the agent rail directly because that would force re-renders of the
  // entire page on every animation frame; here we tick once every 250ms
  // and only the rail subscribes to runElapsedMs.
  useEffect(() => {
    if (runStatus !== 'running' || runStartedAt == null) {
      return;
    }
    const id = setInterval(() => {
      setRunElapsedMs(Date.now() - runStartedAt);
    }, 250);
    return () => clearInterval(id);
  }, [runStatus, runStartedAt]);

  // When the user switches to a different market the hook re-runs with a new
  // marketId; swap in that market's history. We only swap when transitioning
  // between two different non-null ids — null→non-null happens on initial
  // market load and would wipe in-flight messages typed before the market
  // resolved. The lazy initializer already handled the first load.
  const lastMarketIdRef = useRef<string | null>(marketId);
  useEffect(() => {
    const prev = lastMarketIdRef.current;
    if (prev === marketId) return;
    lastMarketIdRef.current = marketId;
    if (prev === null || marketId === null) return; // ignore null transitions
    setMessages(loadFromStorage(marketId));
    setError(null);
  }, [marketId]);

  // Persist on every change. setMessages can mutate during streaming, so this
  // effect captures partial in-flight answers too — refresh mid-stream and
  // you keep what arrived.
  useEffect(() => {
    saveToStorage(marketId, messages);
  }, [marketId, messages]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !market) return;

      setBusy(true);
      setError(null);
      setMessages((m) => [...m, { role: 'user', content: trimmed }]);
      const runStart = Date.now();
      setRunStartedAt(runStart);
      setRunStatus('running');
      setRunElapsedMs(0);

      try {
        const res = await apiFetch('/api/ask', {
          method: 'POST',
          headers: { accept: 'text/event-stream' },
          body: { marketId: (market as { marketId?: string }).marketId, market, question: trimmed } as unknown as BodyInit,
        });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        // Manual SSE frame parser. Each frame is `data: {...}\n\n`.
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        const acc: ChatMessage = { role: 'ai', content: '', citations: [] };

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx = buf.indexOf('\n\n');
          while (idx !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                const ev = JSON.parse(payload) as AskEvent;
                handleAskEvent(ev, acc, setMessages);
              } catch {
                /* malformed frame — skip */
              }
            }
            idx = buf.indexOf('\n\n');
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setMessages((m) => [...m, { role: 'ai', content: `error: ${msg}` }]);
        setRunStatus('error');
      } finally {
        setBusy(false);
        const final = Date.now() - runStart;
        setLastElapsedMs(final);
        setRunElapsedMs(final);
        setRunStartedAt(null);
        // If we didn't already mark it as 'error' in the catch block, then we
        // got here cleanly — the SSE stream completed and ask:done has been
        // dispatched. Mark as done so the rail flips from running to DONE.
        setRunStatus((s) => (s === 'error' ? 'error' : 'done'));
      }
    },
    [market],
  );

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    if (marketId && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(`${STORAGE_PREFIX}${marketId}`);
      } catch {
        /* ignore */
      }
    }
  }, [marketId]);

  return { messages, send, busy, error, clear, runStatus, runElapsedMs, lastElapsedMs };
}

/**
 * Replace the trailing AI placeholder with `acc`, OR append a new AI message
 * if the last message is the user's question. This makes the handler robust
 * to ordering: server-side ensureGrounding emits ask:progress BEFORE runAsk
 * emits ask:start, so the first event the client sees may be progress, not
 * start. Naively slicing off the last message in that case would wipe the
 * user's question (the bug we're fixing).
 */
function commitAi(
  acc: ChatMessage,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
): void {
  setMessages((m) => {
    const last = m[m.length - 1];
    if (last && last.role === 'ai') {
      return [...m.slice(0, -1), { ...acc }];
    }
    return [...m, { ...acc }];
  });
}

function handleAskEvent(
  ev: AskEvent,
  acc: ChatMessage,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
): void {
  switch (ev.t) {
    case 'ask:start':
      acc.content = '';
      acc.citations = [];
      // Same defensive logic — if an AI placeholder already exists from a
      // pre-start progress event, swap rather than double-append.
      commitAi(acc, setMessages);
      break;
    case 'ask:progress':
      acc.content += ev.message;
      commitAi(acc, setMessages);
      break;
    case 'ask:done': {
      // Join with double newlines so the renderer can split each claim into
      // its own visual section block. The ask agent now emits one claim per
      // section (numbers/holders/catalysts/sentiment/thesis-yes/thesis-no)
      // each prefixed with a `**Section:**` markdown label that Chat.tsx
      // pulls out as a styled header.
      const text = ev.answer.claims.map((c) => c.text).join('\n\n');
      const citationIds = ev.answer.citations.map((c) => c.id);
      acc.content = text || acc.content;
      acc.citations = citationIds;
      commitAi(acc, setMessages);
      break;
    }
    case 'ask:error':
      acc.content = `error: ${ev.error}`;
      commitAi(acc, setMessages);
      break;
  }
}
