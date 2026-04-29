// useProvider — manages BYOK provider keys via cryptoStorage.
//
// Plaintext keys are NEVER held in React state — only presence flags. When a
// caller needs the actual key (e.g. to attach to a request that EventSource
// can't header), call getKeys() which returns a freshly decrypted snapshot.

import { useCallback, useEffect, useState } from 'react';
import type { ProviderConfig, ProviderName, ProviderSlot } from '../types';
import { deleteSecret, getSecret, setSecret } from '../lib/cryptoStorage';

const SECRET_KEY_PRIMARY = 'byok:primary';
const SECRET_KEY_PRIMARY_PROVIDER = 'byok:primary:provider';
const SECRET_KEY_PERPLEXITY = 'byok:perplexity';
const SECRET_KEY_XAI = 'byok:xai';

const KNOWN_PROVIDERS: readonly ProviderName[] = [
  'anthropic',
  'anthropic-cc',
  'openai',
  'google',
  'perplexity',
  'xai',
];

function isProviderName(x: unknown): x is ProviderName {
  return typeof x === 'string' && (KNOWN_PROVIDERS as readonly string[]).includes(x);
}

export type ProviderKeyBundle = {
  primary?: { provider: ProviderName; key: string };
  perplexity?: string;
  xai?: string;
};

export type UseProviderResult = {
  config: ProviderConfig;
  loading: boolean;
  setKey: (slot: ProviderSlot, provider: ProviderName | null, key: string) => Promise<void>;
  clearKey: (slot: ProviderSlot) => Promise<void>;
  getKeys: () => Promise<ProviderKeyBundle>;
};

const EMPTY_CONFIG: ProviderConfig = {
  primary: null,
  hasPrimaryKey: false,
  hasPerplexity: false,
  hasXai: false,
};

async function readConfig(): Promise<ProviderConfig> {
  const [primary, primaryProvider, perplexity, xai] = await Promise.all([
    getSecret(SECRET_KEY_PRIMARY),
    getSecret(SECRET_KEY_PRIMARY_PROVIDER),
    getSecret(SECRET_KEY_PERPLEXITY),
    getSecret(SECRET_KEY_XAI),
  ]);
  return {
    primary: isProviderName(primaryProvider) ? primaryProvider : null,
    hasPrimaryKey: Boolean(primary),
    hasPerplexity: Boolean(perplexity),
    hasXai: Boolean(xai),
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
      const next = await readConfig();
      setConfig(next);
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
    return () => {
      active = false;
    };
  }, [refresh]);

  const setKey = useCallback(
    async (slot: ProviderSlot, provider: ProviderName | null, key: string): Promise<void> => {
      if (typeof window === 'undefined') return;
      if (slot === 'primary') {
        await setSecret(SECRET_KEY_PRIMARY, key);
        if (provider) {
          await setSecret(SECRET_KEY_PRIMARY_PROVIDER, provider);
        } else {
          await deleteSecret(SECRET_KEY_PRIMARY_PROVIDER);
        }
      } else if (slot === 'perplexity') {
        await setSecret(SECRET_KEY_PERPLEXITY, key);
      } else {
        await setSecret(SECRET_KEY_XAI, key);
      }
      await refresh();
    },
    [refresh],
  );

  const clearKey = useCallback(
    async (slot: ProviderSlot): Promise<void> => {
      if (typeof window === 'undefined') return;
      if (slot === 'primary') {
        await deleteSecret(SECRET_KEY_PRIMARY);
        await deleteSecret(SECRET_KEY_PRIMARY_PROVIDER);
      } else if (slot === 'perplexity') {
        await deleteSecret(SECRET_KEY_PERPLEXITY);
      } else {
        await deleteSecret(SECRET_KEY_XAI);
      }
      await refresh();
    },
    [refresh],
  );

  const getKeys = useCallback(async (): Promise<ProviderKeyBundle> => {
    if (typeof window === 'undefined') return {};
    const [primary, primaryProvider, perplexity, xai] = await Promise.all([
      getSecret(SECRET_KEY_PRIMARY),
      getSecret(SECRET_KEY_PRIMARY_PROVIDER),
      getSecret(SECRET_KEY_PERPLEXITY),
      getSecret(SECRET_KEY_XAI),
    ]);
    const out: ProviderKeyBundle = {};
    if (primary && isProviderName(primaryProvider)) {
      out.primary = { provider: primaryProvider, key: primary };
    }
    if (perplexity) out.perplexity = perplexity;
    if (xai) out.xai = xai;
    return out;
  }, []);

  return { config, loading, setKey, clearKey, getKeys };
}
