// useAuth.test.ts — locks in the wallet + onboarding gate.
//
// The cf-azure rewrite changes deploy targets but NOT this hook's
// behavior. The crucial invariants:
//   1. signedIn === true ONLY when both wallet AND onboardingComplete
//      are set. The Twitter-screen-skipped bug (commit 316ab56) was
//      caused by `signedIn = !!wallet`; we must not regress.
//   2. setWallet only persists if the address looks like a 0x EVM addr.
//   3. setXHandle strips a leading @ and lowercases.
//   4. signOut wipes all three localStorage keys.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth, isPlausibleEvmAddress } from './useAuth';

beforeEach(() => {
  // jsdom localStorage persists between tests by default
  window.localStorage.clear();
});

describe('isPlausibleEvmAddress', () => {
  it('accepts 0x + 40 hex chars', () => {
    expect(isPlausibleEvmAddress('0x' + 'a'.repeat(40))).toBe(true);
    expect(isPlausibleEvmAddress('0x' + 'A'.repeat(40))).toBe(true);
    expect(isPlausibleEvmAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });

  it('rejects malformed inputs', () => {
    expect(isPlausibleEvmAddress('')).toBe(false);
    expect(isPlausibleEvmAddress('0x1')).toBe(false);                                // too short
    expect(isPlausibleEvmAddress('0x' + 'g'.repeat(40))).toBe(false);                // non-hex
    expect(isPlausibleEvmAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false); // no 0x
    expect(isPlausibleEvmAddress('0x' + 'a'.repeat(41))).toBe(false);                // too long
  });

  it('trims whitespace before validating', () => {
    expect(isPlausibleEvmAddress('  0x' + 'a'.repeat(40) + '  ')).toBe(true);
  });
});

describe('useAuth — signedIn gate', () => {
  it('signedIn is false on cold start (no wallet, no onboarding flag)', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.signedIn).toBe(false);
    expect(result.current.wallet).toBeNull();
    expect(result.current.onboardingComplete).toBe(false);
  });

  it('signedIn stays false after only wallet is set (Twitter step still pending)', () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setWallet('0x' + 'a'.repeat(40));
    });
    // CRITICAL: this is the bug from commit 316ab56. signedIn must NOT
    // flip just because wallet got set; the LandingFlow needs to stay
    // mounted through the Twitter step.
    expect(result.current.wallet).toBe('0x' + 'a'.repeat(40));
    expect(result.current.signedIn).toBe(false);
  });

  it('signedIn stays false after only completeOnboarding (no wallet)', () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.completeOnboarding();
    });
    expect(result.current.onboardingComplete).toBe(true);
    expect(result.current.signedIn).toBe(false);
  });

  it('signedIn becomes true ONLY when both wallet AND completeOnboarding fire', () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setWallet('0x' + 'a'.repeat(40));
    });
    expect(result.current.signedIn).toBe(false);
    act(() => {
      result.current.completeOnboarding();
    });
    expect(result.current.signedIn).toBe(true);
  });
});

describe('useAuth — setWallet validation', () => {
  it('persists a valid wallet to localStorage', () => {
    const { result } = renderHook(() => useAuth());
    const addr = '0x' + 'b'.repeat(40);
    act(() => {
      result.current.setWallet(addr);
    });
    expect(window.localStorage.getItem('pm-copilot:auth:wallet')).toBe(addr);
  });

  it('silently rejects invalid wallets (no localStorage write, no state change)', () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setWallet('not an address');
    });
    expect(result.current.wallet).toBeNull();
    expect(window.localStorage.getItem('pm-copilot:auth:wallet')).toBeNull();
  });
});

describe('useAuth — setXHandle', () => {
  it('strips leading @ and persists', () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setXHandle('@vitalikbuterin');
    });
    expect(result.current.xHandle).toBe('vitalikbuterin');
    expect(window.localStorage.getItem('pm-copilot:auth:x-handle')).toBe('vitalikbuterin');
  });

  it('persists handles that already lack @', () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setXHandle('VitalikButerin');
    });
    expect(result.current.xHandle).toBe('VitalikButerin');
  });

  it('null and empty string clear the handle', () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setXHandle('test');
    });
    expect(result.current.xHandle).toBe('test');
    act(() => {
      result.current.setXHandle(null);
    });
    expect(result.current.xHandle).toBeNull();
    expect(window.localStorage.getItem('pm-copilot:auth:x-handle')).toBeNull();
  });
});

describe('useAuth — signOut', () => {
  it('wipes all three localStorage keys', () => {
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setWallet('0x' + 'c'.repeat(40));
      result.current.setXHandle('alice');
      result.current.completeOnboarding();
    });
    // sanity
    expect(result.current.signedIn).toBe(true);
    act(() => {
      result.current.signOut();
    });
    expect(result.current.wallet).toBeNull();
    expect(result.current.xHandle).toBeNull();
    expect(result.current.onboardingComplete).toBe(false);
    expect(result.current.signedIn).toBe(false);
    expect(window.localStorage.getItem('pm-copilot:auth:wallet')).toBeNull();
    expect(window.localStorage.getItem('pm-copilot:auth:x-handle')).toBeNull();
    expect(window.localStorage.getItem('pm-copilot:auth:onboarded')).toBeNull();
  });
});

describe('useAuth — hydration from existing localStorage', () => {
  it('reads wallet, handle, and onboarded flag on mount', () => {
    window.localStorage.setItem('pm-copilot:auth:wallet', '0x' + 'd'.repeat(40));
    window.localStorage.setItem('pm-copilot:auth:x-handle', 'preset');
    window.localStorage.setItem('pm-copilot:auth:onboarded', '1');
    const { result } = renderHook(() => useAuth());
    expect(result.current.wallet).toBe('0x' + 'd'.repeat(40));
    expect(result.current.xHandle).toBe('preset');
    expect(result.current.onboardingComplete).toBe(true);
    expect(result.current.signedIn).toBe(true);
  });
});
