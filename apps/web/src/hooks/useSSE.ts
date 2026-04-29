// useSSE — generic EventSource subscription hook.
//
// Opens a single EventSource per (url, nonce) pair. Each `message` payload is
// JSON-parsed and pushed into an `events` array. Errors close the connection
// (no infinite reconnect storms). `reconnect()` bumps the nonce for a manual
// retry. Cleanup closes the stream on unmount or url change.

import { useEffect, useMemo, useRef, useState } from 'react';

export type SSEState = 'idle' | 'open' | 'closed' | 'error';

export type UseSSEResult<T> = {
  events: T[];
  state: SSEState;
  reconnect: () => void;
};

export type UseSSEOptions = {
  withCredentials?: boolean;
};

export function useSSE<T = unknown>(
  url: string | null,
  options?: UseSSEOptions,
): UseSSEResult<T> {
  const [events, setEvents] = useState<T[]>([]);
  const [state, setState] = useState<SSEState>('idle');
  const [nonce, setNonce] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  // Stable options snapshot so the effect doesn't re-fire on object identity.
  const withCredentials = options?.withCredentials ?? false;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!url) {
      setState('idle');
      return;
    }

    // Reset event buffer each time we open a new stream.
    setEvents([]);
    setState('idle');

    let closed = false;
    const es = new EventSource(url, { withCredentials });
    esRef.current = es;

    es.onopen = () => {
      if (closed) return;
      setState('open');
    };

    es.onmessage = (ev: MessageEvent<string>) => {
      if (closed) return;
      let parsed: T;
      try {
        parsed = JSON.parse(ev.data) as T;
      } catch {
        // Skip un-parseable payloads rather than throwing — SSE comments
        // (lines starting with ':') already surface as empty data.
        return;
      }
      setEvents((prev) => [...prev, parsed]);
    };

    es.onerror = () => {
      if (closed) return;
      // EventSource fires `error` both on transient blips and final close.
      // We deliberately do NOT auto-reconnect: the hook caller can choose to
      // call reconnect() if they want another attempt.
      setState('error');
      try {
        es.close();
      } catch {
        // ignore
      }
    };

    return () => {
      closed = true;
      try {
        es.close();
      } catch {
        // ignore
      }
      esRef.current = null;
      setState('closed');
    };
  }, [url, withCredentials, nonce]);

  return useMemo<UseSSEResult<T>>(
    () => ({
      events,
      state,
      reconnect: () => setNonce((n) => n + 1),
    }),
    [events, state],
  );
}
