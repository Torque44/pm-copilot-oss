// SSE frame writer — minimal, no dependencies.
//
// `core` does NOT depend on express (server-only). We use the structural
// subset of express's Response we actually call: writeHead, write, end, on.
// Server passes its real `express.Response` here; the structural fit lets
// core stay framework-free.

export type SseResponseLike = {
  writeHead: (status: number, headers?: Record<string, string>) => unknown;
  write: (chunk: string) => unknown;
  end: () => unknown;
  on: (event: 'close', listener: () => void) => unknown;
};

export type SseWriter = {
  send: (event: unknown) => void;
  close: () => void;
  closed: boolean;
};

export function openSse(res: SseResponseLike, onClose?: () => void): SseWriter {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Flush headers immediately
  res.write(':' + ' '.repeat(2048) + '\n'); // padding to defeat any proxy buffering
  res.write('retry: 10000\n\n');

  let closed = false;
  const writer: SseWriter = {
    send(event) {
      if (closed) return;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try { res.end(); } catch { /* ignore */ }
    },
    get closed() { return closed; },
  };

  // Heartbeat every 15s to keep connection open.
  const hb = setInterval(() => {
    if (closed) return;
    try { res.write(': hb\n\n'); } catch { /* ignore */ }
  }, 15000);

  res.on('close', () => {
    closed = true;
    clearInterval(hb);
    onClose?.();
  });

  return writer;
}
