// useProvider — manages BYOK provider keys via cryptoStorage.
//
// SCHEMA (v2 — per-provider slots, auto-rank primary, explicit override):
//
//   byok:key:anthropic              ← anthropic API key
//   byok:key:google                 ← gemini API key
//   byok:key:openai                 ← openai API key
//   byok:key:xai                    ← xai API key (eligible for primary AND sentiment)
//   byok:cc-enabled = '1'           ← marker that the local Claude Code subprocess is enabled
//   byok:perplexity                 ← perplexity key (sub-role: news enhancement only)
//   byok:primary:override           ← explicit primary provider name, or empty for auto-rank
//
// Auto-rank (when no explicit override): claude > gemini > openai > xai
//   ['anthropic-cc', 'anthropic', 'google', 'openai', 'xai']
//
// Multiple keys can coexist. Pasting a key in one tile no longer overwrites
// another — each provider has its own slot. The primary is computed.
//
// MIGRATION (v1 → v2): on first load we read the legacy slots
//   byok:primary, byok:primary:provider, byok:xai
// and copy them into the new per-provider slots, then mark migration done.
// Legacy slots remain readable for one release in case we need to roll back.
//
// Plaintext keys are NEVER held in React state — only presence flags. When a
// caller needs the actual key (e.g. to attach as a request header), call
// getKeys() which returns a freshly decrypted snapshot.

import { useCallback, useEffect, useState } from 'react';
import type { ProviderConfig, ProviderName } from '../types';
import { deleteSecret, getSecret, setSecret } from '../lib/cryptoStorage';

// ── New per-provider storage slots ──
const KEY_ANTHROPIC = 'byok:key:anthropic';
const KEY_GOOGLE = 'byok:key:google';
const KEY_OPENAI = 'byok:key:openai';
const KEY_XAI = 'byok:key:xai';
const KEY_PERPLEXITY = 'byok:perplexity';
const CC_ENABLED = 'byok:cc-enabled';
const PRIMARY_OVERRIDE = 'byok:primary:override';
const MIGRATED_FLAG = 'byok:migrated:v2';

// ── Legacy slots (read-only after migration) ──
const LEGACY_PRIMARY = 'byok:primary';
const LEGACY_PRIMARY_PROVIDER = 'byok:primary:provider';
const LEGACY_XAI = 'byok:xai';

/** Orchestrator rank — when no explicit primary override is set, the highest-
 *  tier connected provider on this list becomes the orchestrator (drives
 *  brief synthesis, ask routing, thesis). User-controllable via the "use as
 *  primary" button per tile, which writes PRIMARY_OVERRIDE. */
const ORCHESTRATOR_RANK: readonly ProviderName[] = [
  'anthropic-cc',  // local Claude Code subprocess — no key cost
  'anthropic',     // Claude API
  'google',        // Gemini
  'openai',        // GPT
  'xai',           // Grok
];

const KNOWN_PROVIDERS: readonly ProviderName[] = [
  'anthropic', 'anthropic-cc', 'openai', 'google', 'perplexity', 'xai',
];

function isProviderName(x: unknown): x is ProviderName {
  return typeof x === 'string' && (KNOWN_PROVIDERS as readonly string[]).includes(x);
}

export type ProviderKeyBundle = {
  /** The computed orchestrator: explicit override if set, else top-ranked
   *  connected. `key` is null for anthropic-cc (subprocess uses no key). */
  primary?: { provider: ProviderName; key: string | null };
  perplexity?: string;
  /** xAI key for sentiment + ask live-search. Same value the primary uses
   *  if primary === 'xai', surfaced separately so the server-side router
   *  can fan it into both routing.primary and routing.sentiment. */
  xai?: string;
};

export type UseProviderResult = {
  config: ProviderConfig;
  loading: boolean;
  /** Paste-or-update a key for any provider. Writes to that provider's
   *  dedicated slot (so other providers' keys remain intact). */
  setKey: (provider: ProviderName, key: string) => Promise<void>;
  /** Mark the local Claude Code subprocess as available. */
  setUseClaudeCode: () => Promise<void>;
  /** Remove a provider's stored key. If that provider was the explicit
   *  primary override, the override is cleared too (auto-rank takes over). */
  clearKey: (provider: ProviderName) => Promise<void>;
  /** Explicitly pick which connected provider acts as the orchestrator
   *  (overrides the auto-rank). Pass null to clear the override. */
  setPrimaryOverride: (provider: ProviderName | null) => Promise<void>;
  getKeys: () => Promise<ProviderKeyBundle>;
};

const EMPTY_CONFIG: ProviderConfig = {
  primary: null,
  primaryIsExplicit: false,
  hasAnthropic: false,
  hasAnthropicCC: false,
  hasGoogle: false,
  hasOpenAI: false,
  hasXai: false,
  hasPerplexity: false,
};

/** Read all keys (presence-only, returns booleans) plus the override and
 *  return both the per-provider flags and the computed primary. */
async function readAllSlots() {
  const [
    anthropic, google, openai, xai, perplexity,
    ccEnabled, override, migrated,
  ] = await Promise.all([
    getSecret(KEY_ANTHROPIC),
    getSecret(KEY_GOOGLE),
    getSecret(KEY_OPENAI),
    getSecret(KEY_XAI),
    getSecret(KEY_PERPLEXITY),
    getSecret(CC_ENABLED),
    getSecret(PRIMARY_OVERRIDE),
    getSecret(MIGRATED_FLAG),
  ]);
  return {
    anthropic, google, openai, xai, perplexity,
    hasCC: ccEnabled === '1',
    override: isProviderName(override) ? override : null,
    migrated: migrated === '1',
  };
}

/** Migrate from v1 (single byok:primary slot) to v2 (per-provider slots).
 *  Idempotent — the migrated flag prevents repeated runs. */
async function migrateIfNeeded() {
  const flag = await getSecret(MIGRATED_FLAG);
  if (flag === '1') return;
  const [oldPrimary, oldPrimaryProvider, oldXai] = await Promise.all([
    getSecret(LEGACY_PRIMARY),
    getSecret(LEGACY_PRIMARY_PROVIDER),
    getSecret(LEGACY_XAI),
  ]);
  // Map the legacy primary onto its per-provider slot if we recognise it.
  if (oldPrimaryProvider === 'anthropic-cc') {
    await setSecret(CC_ENABLED, '1');
    await setSecret(PRIMARY_OVERRIDE, 'anthropic-cc');
  } else if (isProviderName(oldPrimaryProvider) && oldPrimary) {
    const slot = providerKeySlot(oldPrimaryProvider);
    if (slot) await setSecret(slot, oldPrimary);
    await setSecret(PRIMARY_OVERRIDE, oldPrimaryProvider);
  }
  // Sentiment-only xai legacy slot → unify into byok:key:xai.
  if (oldXai && !(await getSecret(KEY_XAI))) {
    await setSecret(KEY_XAI, oldXai);
  }
  await setSecret(MIGRATED_FLAG, '1');
}

/** Map a provider name to its per-provider key slot. Perplexity has a
 *  dedicated slot but isn't a primary candidate, so callers handle it
 *  separately. anthropic-cc has no key (subprocess marker only). */
function providerKeySlot(p: ProviderName): string | null {
  switch (p) {
    case 'anthropic': return KEY_ANTHROPIC;
    case 'google':    return KEY_GOOGLE;
    case 'openai':    return KEY_OPENAI;
    case 'xai':       return KEY_XAI;
    case 'perplexity': return KEY_PERPLEXITY;
    case 'anthropic-cc': return null;
    default: return null;
  }
}

/** Determine whether a provider is "connected" — has a usable credential
 *  or the subprocess marker. */
function isConnected(
  p: ProviderName,
  slots: Awaited<ReturnType<typeof readAllSlots>>,
): boolean {
  switch (p) {
    case 'anthropic-cc': return slots.hasCC;
    case 'anthropic':    return Boolean(slots.anthropic);
    case 'google':       return Boolean(slots.google);
    case 'openai':       return Boolean(slots.openai);
    case 'xai':          return Boolean(slots.xai);
    case 'perplexity':   return Boolean(slots.perplexity);
    default: return false;
  }
}

/** Compute the orchestrator: explicit override beats auto-rank. */
function computePrimary(
  slots: Awaited<ReturnType<typeof readAllSlots>>,
): { provider: ProviderName | null; isExplicit: boolean } {
  if (slots.override && isConnected(slots.override, slots)) {
    return { provider: slots.override, isExplicit: true };
  }
  for (const p of ORCHESTRATOR_RANK) {
    if (isConnected(p, slots)) return { provider: p, isExplicit: false };
  }
  return { provider: null, isExplicit: false };
}

async function readConfig(): Promise<ProviderConfig> {
  await migrateIfNeeded();
  const slots = await readAllSlots();
  const { provider: primary, isExplicit } = computePrimary(slots);
  return {
    primary,
    primaryIsExplicit: isExplicit,
    hasAnthropic: Boolean(slots.anthropic),
    hasAnthropicCC: slots.hasCC,
    hasGoogle: Boolean(slots.google),
    hasOpenAI: Boolean(slots.openai),
    hasXai: Boolean(slots.xai),
    hasPerplexity: Boolean(slots.perplexity),
  };
}

export function useProvider(): UseProviderResult {
  const [config, setConfig] = useState<ProviderConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') {
      setConfig(EMPTY_CONFIG);
      setLoading(false);
      return;
    }
    try {
      setConfig(await readConfig());
    } catch {
      setConfig(EMPTY_CONFIG);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      await refresh();
      if (!active) return;
    })();
    return () => { active = false; };
  }, [refresh]);

  const setKey = useCallback(
    async (provider: ProviderName, key: string): Promise<void> => {
      if (typeof window === 'undefined') return;
      const slot = providerKeySlot(provider);
      if (!slot) return; // anthropic-cc has no key — use setUseClaudeCode
      await setSecret(slot, key);
      await refresh();
    },
    [refresh],
  );

  const setUseClaudeCode = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined') return;
    await setSecret(CC_ENABLED, '1');
    await refresh();
  }, [refresh]);

  const clearKey = useCallback(
    async (provider: ProviderName): Promise<void> => {
      if (typeof window === 'undefined') return;
      if (provider === 'anthropic-cc') {
        await deleteSecret(CC_ENABLED);
      } else {
        const slot = providerKeySlot(provider);
        if (slot) await deleteSecret(slot);
      }
      // If the cleared provider was the explicit override, clear that too
      // so auto-rank can take over instead of pointing at nothing.
      const override = await getSecret(PRIMARY_OVERRIDE);
      if (override === provider) await deleteSecret(PRIMARY_OVERRIDE);
      await refresh();
    },
    [refresh],
  );

  const setPrimaryOverride = useCallback(
    async (provider: ProviderName | null): Promise<void> => {
      if (typeof window === 'undefined') return;
      if (provider) await setSecret(PRIMARY_OVERRIDE, provider);
      else await deleteSecret(PRIMARY_OVERRIDE);
      await refresh();
    },
    [refresh],
  );

  const getKeys = useCallback(async (): Promise<ProviderKeyBundle> => {
    if (typeof window === 'undefined') return {};
    await migrateIfNeeded();
    const slots = await readAllSlots();
    const { provider: primary } = computePrimary(slots);
    const out: ProviderKeyBundle = {};
    if (primary) {
      const slot = providerKeySlot(primary);
      const k = slot ? await getSecret(slot) : null;
      // anthropic-cc has key=null (subprocess marker carries the auth state)
      out.primary = { provider: primary, key: k ?? null };
    }
    if (slots.perplexity) out.perplexity = slots.perplexity;
    if (slots.xai) out.xai = slots.xai;
    return out;
  }, []);

  return { config, loading, setKey, setUseClaudeCode, clearKey, setPrimaryOverride, getKeys };
}
