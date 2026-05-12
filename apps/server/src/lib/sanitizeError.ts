// sanitizeError.ts — server-side re-export of the core sanitiser. The
// canonical implementation lives in @pm-copilot/core/providers/sanitizeError
// so provider modules in packages/core can use it without depending on
// apps/server. Tests cover the core copy.

export {
  sanitizeProviderError,
  redactKeyFragments,
  sanitizeUpstreamErrorBody,
} from '@pm-copilot/core/providers/sanitizeError';
