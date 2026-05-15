// useAuth — minimal session state for the landing → desk flow.
//
// What this stores:
//   - `wallet`           — a Polymarket wallet address (0x...) the user
//     pasted, signed in via window.ethereum, or otherwise provided.
//   - `xHandle`          — the user's X / Twitter handle (no @). Optional.
//   - `onboardingComplete` — separate gate flag that flips ONLY after the
//     user finishes the full landing → wallet → twitter → handoff flow
//     OR explicitly skips the twitter step. Without this flag, App.tsx
//     would unmount LandingFlow the moment a wallet was set, which
//     skipped the Twitter step entirely (the bug the user hit).
//
// What this is NOT:
//   - Real cryptographic auth. There's no signed challenge, no JWT, no
//     server-side session. The product is read-only — we only need an
//     identifier to load wallet-keyed Polymarket data and to bias the
//     news weighting. Any user "claims" any wallet they want; if it's
//     not theirs they just see someone else's positions, no harm done.
//
// Persistence: localStorage, namespaced under `pm-copilot:auth:*`. Cleared
// by signOut(). Reads are synchronous so the App can gate its first paint
// on whether the user is already signed in.

import { useCallback, useEffect, useState } from 'react';

const KEY_WALLET = 'pm-copilot:auth:wallet';
const KEY_HANDLE = 'pm-copilot:auth:x-handle';
const KEY_ONBOARDED = 'pm-copilot:auth:onboarded';

export type AuthState = {
  wallet: string | null;
  xHandle: string | null;
  onboardingComplete: boolean;
};

function readState(): AuthState {
  if (typeof window === 'undefined') {
    return { wallet: null, xHandle: null, onboardingComplete: false };
  }
  return {
    wallet: window.localStorage.getItem(KEY_WALLET),
    xHandle: window.localStorage.getItem(KEY_HANDLE),
    onboardingComplete: window.localStorage.getItem(KEY_ONBOARDED) === '1',
  };
}

export type UseAuthResult = {
  /** True once the user has finished the onboarding flow — wallet is
   *  optional (May 2026 change to remove the highest-friction gate
   *  blocking the workbench). Most of the product (briefs, asks, market
   *  views) doesn't need a wallet; positions in the right rail are the
   *  only feature that does, and that surface degrades gracefully when
   *  wallet is null. */
  signedIn: boolean;
  wallet: string | null;
  xHandle: string | null;
  onboardingComplete: boolean;
  setWallet: (addr: string) => void;
  setXHandle: (handle: string | null) => void;
  /** Called by LandingFlow after the handoff loader finishes. Flips the
   *  gate so the next App render shows the desk. */
  completeOnboarding: () => void;
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
      if (e.key === KEY_WALLET || e.key === KEY_HANDLE || e.key === KEY_ONBOARDED) {
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

  const completeOnboarding = useCallback(() => {
    window.localStorage.setItem(KEY_ONBOARDED, '1');
    setState((s) => ({ ...s, onboardingComplete: true }));
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(KEY_WALLET);
    window.localStorage.removeItem(KEY_HANDLE);
    window.localStorage.removeItem(KEY_ONBOARDED);
    setState({ wallet: null, xHandle: null, onboardingComplete: false });
  }, []);

  return {
    // Wallet is no longer required to enter the workbench. Completing
    // onboarding (with or without wallet) is the single gate. The
    // positions tab in the right rail handles a null wallet by showing
    // an "add your Polymarket address to see positions" placeholder.
    signedIn: state.onboardingComplete,
    wallet: state.wallet,
    xHandle: state.xHandle,
    onboardingComplete: state.onboardingComplete,
    setWallet,
    setXHandle,
    completeOnboarding,
    signOut,
  };
}
