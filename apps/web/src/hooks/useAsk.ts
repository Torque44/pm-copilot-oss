// useAsk — POST /api/ask with the loaded market + a question, then read the
// SSE response via fetch + ReadableStream (because the server requires the
// market in the request body, EventSource can't reach it).

import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/client';
import type { ChatMessage } from '../types';

type AskAnswer = {
  claims: { text: string; citations: string[] }[];
  citations: { id: string; kind: string; label?: string; url?: string }[];
};

type AskEvent =
  | { t: 'ask:start' }
  | { t: 'ask:progress'; message: string }
  | { t: 'ask:done'; answer: AskAnswer; elapsedMs: number }
  | { t: 'ask:error'; error: string; elapsedMs: number };

export type UseAskResult = {
  messages: ChatMessage[];
  send: (text: string) => Promise<void>;
  busy: boolean;
  error: string | null;
};

/**
 * The market argument is whatever shape the server's /api/ask `parseMarket`
 * expects: an object with marketId, tokenIdYes, tokenIdNo, and the rest of
 * MarketMeta. The hook does no validation — server returns 400 if invalid.
 */
export function useAsk(market: unknown): UseAskResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !market) return;

      setBusy(true);
      setError(null);
      setMessages((m) => [...m, { role: 'user', content: trimmed }]);

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
      } finally {
        setBusy(false);
      }
    },
    [market],
  );

  return { messages, send, busy, error };
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
      setMessages((m) => [...m, acc]);
      break;
    case 'ask:progress':
      acc.content += ev.message;
      setMessages((m) => [...m.slice(0, -1), { ...acc }]);
      break;
    case 'ask:done': {
      const text = ev.answer.claims.map((c) => c.text).join(' ');
      const citationIds = ev.answer.citations.map((c) => c.id);
      acc.content = text || acc.content;
      acc.citations = citationIds;
      setMessages((m) => [...m.slice(0, -1), { ...acc }]);
      break;
    }
    case 'ask:error':
      acc.content = `error: ${ev.error}`;
      setMessages((m) => [...m.slice(0, -1), { ...acc }]);
      break;
  }
}
