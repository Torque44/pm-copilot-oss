// Safe-href guard. Rejects javascript:, data:, vbscript:, file:, and any
// scheme that isn't http/https/mailto. Returns the original URL when safe,
// null when not. Components that render user-derived or LLM-derived hrefs
// MUST gate through this — direct `href={someUrl}` is forbidden.

export function isSafeHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Allow relative URLs and protocol-relative URLs (// → https in modern browsers).
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  // Whitelist of allowed schemes.
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!m) return trimmed; // no scheme → treat as relative path
  const scheme = m[1]!.toLowerCase();
  if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return trimmed;
  return null;
}
