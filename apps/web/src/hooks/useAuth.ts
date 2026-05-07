// useAuth — minimal session state for the landing → desk flow.
//
// What this stores:
//   - `wallet`  — a Polymarket wallet address (0x...) the user pasted or
//     resolved through a wallet connector. Used downstream to load
//     positions in the right rail.
//   - `xHandle` — the user's X / Twitter handle (no @). Optional. Powers
//     the news + sentiment agents' "weight by accounts you trust" logic
//     once that lands.
//
// What this is NOT:
//   - Real cryptographic auth. There's no signed challenge, no JWT, no
//     server-side session. The product is read-only — we only need an
//     identifier to load wallet-keyed Polymarket data and to bias the
//     news weighting. Any user "claims" any wallet they want; if it's
//     not theirs they just see someone else's positions, no harm done.
//   - A wallet SDK. We sidestep MetaMask / WalletConnect / Coinbase SDKs
//     here so the bundle stays small and there's no chain-rpc dependency.
//     The "Sign in with Polymarket" button in LandingFlow shows the same
//     three wallet rows as the design; clicking any row opens an address-
//     paste step. Real wallet detection can be wired later behind the
//     same useAuth interface — only the landing component needs to know.
//
// Persistence: localStorage, namespaced under `pm-copilot:auth:*`. Cleared
// by signOut(). Reads are synchronous so the App can gate its first paint
// on whether the user is already signed in.

import { useCallback, useEffect, useState } from 'react';

const KEY_WALLET = 'pm-copilot:auth:wallet';
const KEY_HANDLE = 'pm-copilot:auth:x-handle';

export type AuthState = {
  wallet: string | null;
  xHandle: string | null;
};

function readState(): AuthState {
  if (typeof window === 'undefined') return { wallet: null, xHandle: null };
  return {
    wallet: window.localStorage.getItem(KEY_WALLET),
    xHandle: window.localStorage.getItem(KEY_HANDLE),
  };
}

export type UseAuthResult = {
  /** True when at least a wallet is connected. xHandle is optional. */
  signedIn: boolean;
  wallet: string | null;
  xHandle: string | null;
  setWallet: (addr: string) => void;
  setXHandle: (handle: string | null) => void;
  signOut: () => void;
};

/** Light validation for an EVM-style address. We don't checksum-verify
 *  here — Polymarket accepts both checksummed and lowercased addresses,
 *  and we only use the address as a lookup key into the positions API. */
export function isPlausibleEvmAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

export function useAuth(): UseAuthResult {
  const [state, setState] = useState<AuthState>(() => readState());

  // Cross-tab sync: if the user signs in on another tab, this tab picks
  // up the change without a manual refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_WALLET || e.key === KEY_HANDLE) {
        setState(readState());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setWallet = useCallback((addr: string) => {
    const trimmed = addr.trim();
    if (!isPlausibleEvmAddress(trimmed)) return;
    window.localStorage.setItem(KEY_WALLET, trimmed);
    setState((s) => ({ ...s, wallet: trimmed }));
  }, []);

  const setXHandle = useCallback((handle: string | null) => {
    if (handle === null || handle.trim() === '') {
      window.localStorage.removeItem(KEY_HANDLE);
      setState((s) => ({ ...s, xHandle: null }));
      return;
    }
    const cleaned = handle.replace(/^@/, '').trim();
    window.localStorage.setItem(KEY_HANDLE, cleaned);
    setState((s) => ({ ...s, xHandle: cleaned }));
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(KEY_WALLET);
    window.localStorage.removeItem(KEY_HANDLE);
    setState({ wallet: null, xHandle: null });
  }, []);

  return {
    signedIn: !!state.wallet,
    wallet: state.wallet,
    xHandle: state.xHandle,
    setWallet,
    setXHandle,
    signOut,
  };
}
