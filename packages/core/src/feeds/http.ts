// Shared HTTP helper for upstream JSON APIs (Polymarket, ESPN, etc).
// Centralizes the User-Agent + Accept headers and the error shape.

const DEFAULT_UA = 'pm-copilot/0.1';

export type HttpOpts = {
  /** Override the User-Agent header. */
  userAgent?: string;
  /** Extra headers merged onto the defaults. */
  headers?: Record<string, string>;
  /** Optional timeout in milliseconds. Defaults to no timeout. */
  timeoutMs?: number;
};

export async function getJson<T>(url: string, opts: HttpOpts = {}): Promise<T> {
  const ctrl = opts.timeoutMs ? new AbortController() : null;
  const t = ctrl && opts.timeoutMs
    ? setTimeout(() => ctrl.abort(), opts.timeoutMs)
    : null;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': opts.userAgent ?? DEFAULT_UA,
        Accept: 'application/json',
        ...(opts.headers ?? {}),
      },
      signal: ctrl?.signal,
    });
    if (!res.ok) {
      throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    if (t) clearTimeout(t);
  }
}
