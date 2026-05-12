// sanitizeError.ts — defensive sanitiser for provider/upstream error strings.
//
// Two reasons this exists:
//   1. CATEGORICAL HINTS — bucket noisy provider error bodies into a small
//      set of UX-relevant categories ("auth failed", "rate limited", …) so
//      surfaces like the right-rail health indicator or auth-test response
//      don't show raw vendor strings.
//   2. KEY-FRAGMENT REDACTION — gateways and vendor 4xx pages occasionally
//      echo the offending Bearer token / api-key header into the error body.
//      Even truncated, the leading bytes of a key shouldn't end up in logs,
//      cache files, or client responses. `redactKeyFragments` strips known
//      key shapes before truncation/return.

/** Categorical hint suitable for showing to a user. Drops model names, URLs,
 *  vendor stack traces. Returns one of a small fixed set of strings. */
export function sanitizeProviderError(raw: string | undefined): string {
  if (!raw) return 'unknown';
  if (/401|403|unauthor|invalid.*key/i.test(raw)) return 'auth failed — check key';
  if (/timeout|aborted/i.test(raw)) return 'timed out';
  if (/429|rate.*limit|quota/i.test(raw)) return 'rate limited';
  if (/credit balance|insufficient/i.test(raw)) return 'out of credit';
  if (/Not logged in|claude-code|Please run/i.test(raw)) return 'claude code not signed in';
  return 'provider error';
}

/** Strip known API-key shapes from a free-form string before it lands in
 *  logs / disk / client responses. Conservative — only matches well-known
 *  prefixes plus generic Bearer tokens and JWT-shaped tokens. Anything that
 *  matches becomes [REDACTED]. */
export function redactKeyFragments(s: string): string {
  if (!s) return s;
  return s
    // Anthropic / OpenAI / Perplexity / xAI / Google common prefixes
    .replace(/\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,})/g, '[REDACTED]')
    .replace(/\b(pplx-[A-Za-z0-9_-]{8,})/g, '[REDACTED]')
    .replace(/\b(xai-[A-Za-z0-9_-]{8,})/g, '[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
    // Bearer tokens in headers echoed back
    .replace(/Bearer\s+[A-Za-z0-9_\-.~+/=]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/api-key:?\s*[A-Za-z0-9_\-.~+/=]{8,}/gi, 'api-key [REDACTED]')
    // JWT-shaped tokens (three dot-separated base64url segments)
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]');
}

/** One-shot helper: redact key fragments AND truncate. Use at any boundary
 *  where an upstream error body is about to be logged or returned. */
export function sanitizeUpstreamErrorBody(s: string | undefined, maxLen = 300): string {
  if (!s) return '';
  return redactKeyFragments(s).slice(0, maxLen);
}
