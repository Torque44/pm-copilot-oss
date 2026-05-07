// registry.test.ts — locks in the source allowlist + denylist contract.
//
// This is the load-bearing piece of the citation-grounding story. If
// Wikipedia ever slips back into a brief because a denylist regex broke
// during a rewrite, the project's central claim ("AI cannot invent
// sources") becomes false. Tests written against CURRENT behavior to
// baseline what the cf-azure rewrite must preserve.

import { describe, it, expect } from 'vitest';
import { isDenylisted, isAllowlisted, isAllowlistedHandle } from './registry';

describe('isDenylisted', () => {
  // The denylist anchor cases — the canonical bad domains. If any of these
  // ever return false, citations from user-editable sources can land in
  // a brief, and the contract is broken.
  it.each([
    'wikipedia.org',
    'en.wikipedia.org',
    'de.wikipedia.org',           // language subdomain, must match parent
    'simple.wikipedia.org',
    'wikidata.org',
    'wikimedia.org',
    'commons.wikimedia.org',
    'wiktionary.org',
    'medium.com',
    'old.reddit.com',
    'reddit.com',
    'substack.com',
    'fandom.com',
    'quora.com',
    '4chan.org',
  ])('flags %s as denied', (host) => {
    expect(isDenylisted(host)).toBe(true);
  });

  it.each([
    'bloomberg.com',
    'reuters.com',
    'apnews.com',
    'wsj.com',
    'ft.com',
    'theinformation.com',
  ])('does not flag %s (mainstream news, allowed)', (host) => {
    expect(isDenylisted(host)).toBe(false);
  });

  it('handles full URLs not just bare hosts', () => {
    expect(isDenylisted('https://en.wikipedia.org/wiki/Foo')).toBe(true);
    expect(isDenylisted('http://reuters.com/article/123')).toBe(false);
  });

  it('strips www. prefix when checking', () => {
    expect(isDenylisted('https://www.wikipedia.org/')).toBe(true);
    expect(isDenylisted('www.medium.com')).toBe(true);
  });

  it('returns false for empty / malformed input rather than throwing', () => {
    expect(isDenylisted('')).toBe(false);
    expect(() => isDenylisted('not a url')).not.toThrow();
  });
});

describe('isAllowlisted', () => {
  // Subcategories: 'crypto' | 'sports' | 'politics' | 'geopolitics' |
  // 'macro' | 'tech' | 'other'. Use the actual values exported by the
  // module — earlier baseline drafts assumed 'politics-us' which doesn't
  // exist and got TypeError-on-undefined.
  it('allows known politics-allowlisted domains for the politics subcategory', () => {
    expect(isAllowlisted('politics', 'politico.com')).toBe(true);
    expect(isAllowlisted('politics', 'thehill.com')).toBe(true);
  });

  it('rejects domains not on the per-subcategory allowlist', () => {
    expect(isAllowlisted('politics', 'tmz.com')).toBe(false);
  });

  it('handles full URLs', () => {
    expect(isAllowlisted('politics', 'https://politico.com/article/123')).toBe(true);
  });

  it('matches subdomains via endsWith', () => {
    // The implementation does `host === allowed || host.endsWith(`.${allowed}`)`
    expect(isAllowlisted('politics', 'subdomain.politico.com')).toBe(true);
  });

  it('allows crypto-specific domains for crypto subcategory', () => {
    expect(isAllowlisted('crypto', 'theblock.co')).toBe(true);
    expect(isAllowlisted('crypto', 'glassnode.com')).toBe(true);
  });
});

describe('isAllowlistedHandle', () => {
  // Real handles from the crypto profile — pinning a few well-known ones
  // that should never get removed without an explicit policy change.
  it.each([
    ['crypto', 'VitalikButerin'],
    ['crypto', 'cz_binance'],
    ['crypto', 'WuBlockchain'],
    ['sports', 'AdamSchefter'],
    ['sports', 'FabrizioRomano'],
  ])('allows vetted handle %s for %s', (sub, handle) => {
    expect(isAllowlistedHandle(sub as 'crypto' | 'sports', handle)).toBe(true);
  });

  it('strips @ prefix before lookup', () => {
    expect(isAllowlistedHandle('crypto', '@VitalikButerin')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAllowlistedHandle('crypto', 'VITALIKBUTERIN')).toBe(true);
    expect(isAllowlistedHandle('crypto', 'vitalikbuterin')).toBe(true);
    expect(isAllowlistedHandle('crypto', '@Vitalikbuterin')).toBe(true);
  });

  it('rejects unvetted handles', () => {
    expect(isAllowlistedHandle('crypto', 'random_alpha_caller_99')).toBe(false);
    expect(isAllowlistedHandle('sports', 'random_picks_dot_com')).toBe(false);
  });

  it('returns false for empty', () => {
    expect(isAllowlistedHandle('crypto', '')).toBe(false);
    expect(isAllowlistedHandle('crypto', '@')).toBe(false);
  });
});
