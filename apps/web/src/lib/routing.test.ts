// routing.test.ts — Pure-function tests for the URL ↔ Route bridge.
//
// In the cf-azure deploy the frontend is plain Vite (no Vinext, no Next
// router), so this homebrew router stays. The encode/decode round-trip
// MUST be lossless for every Route variant — without it, marketIds with
// special characters (Polymarket slugs sometimes contain hyphens or
// the rare slash) get corrupted.

import { describe, it, expect } from 'vitest';
import { pathToRoute, routeToPath, type Route } from './routing';

describe('routeToPath', () => {
  it('home → /', () => {
    expect(routeToPath({ name: 'home' })).toBe('/');
  });

  it('setup → /setup', () => {
    expect(routeToPath({ name: 'setup' })).toBe('/setup');
  });

  it('settings → /settings', () => {
    expect(routeToPath({ name: 'settings' })).toBe('/settings');
  });

  it('market id → /m/<id>', () => {
    expect(routeToPath({ name: 'market', marketId: 'abc-123' })).toBe('/m/abc-123');
  });

  it('encodes special characters in marketId', () => {
    expect(routeToPath({ name: 'market', marketId: 'a b/c' })).toBe('/m/a%20b%2Fc');
  });

});

describe('pathToRoute', () => {
  it('/ → home', () => {
    expect(pathToRoute('/')).toEqual({ name: 'home' });
  });

  it('empty string → home', () => {
    expect(pathToRoute('')).toEqual({ name: 'home' });
  });

  it('/setup → setup', () => {
    expect(pathToRoute('/setup')).toEqual({ name: 'setup' });
  });

  it('/settings → settings', () => {
    expect(pathToRoute('/settings')).toEqual({ name: 'settings' });
  });

  it('/m/<id> → market', () => {
    expect(pathToRoute('/m/abc-123')).toEqual({ name: 'market', marketId: 'abc-123' });
  });

  it('/event/<id> degrades to home (no UI render path)', () => {
    // /event/:id was previously a declared route but had no handler in
    // App.tsx — direct navigation landed users on an empty screen. The
    // route is now mapped to home so old shareable links don't 404.
    expect(pathToRoute('/event/evt-42')).toEqual({ name: 'home' });
  });

  it('decodes special characters in marketId', () => {
    expect(pathToRoute('/m/a%20b%2Fc')).toEqual({ name: 'market', marketId: 'a b/c' });
  });

  it('strips trailing slash', () => {
    expect(pathToRoute('/m/abc/')).toEqual({ name: 'market', marketId: 'abc' });
  });

  it('strips query string', () => {
    expect(pathToRoute('/m/abc?from=email')).toEqual({ name: 'market', marketId: 'abc' });
  });

  it('strips fragment', () => {
    expect(pathToRoute('/m/abc#section')).toEqual({ name: 'market', marketId: 'abc' });
  });

  it('falls through to home on unknown paths', () => {
    expect(pathToRoute('/garbage/path')).toEqual({ name: 'home' });
    expect(pathToRoute('/m')).toEqual({ name: 'home' });    // missing id
  });
});

describe('round-trip', () => {
  // The critical invariant: pathToRoute(routeToPath(r)) === r for every
  // Route. If this ever breaks, deep links rot during the cf-azure
  // rewrite (different routing host, same client-side parser).
  const cases: Route[] = [
    { name: 'home' },
    { name: 'setup' },
    { name: 'settings' },
    { name: 'market', marketId: 'simple-slug' },
    { name: 'market', marketId: 'with spaces and / slashes' },
    { name: 'market', marketId: 'unicode-π-é' },
  ];
  it.each(cases)('round-trips %j', (r) => {
    expect(pathToRoute(routeToPath(r))).toEqual(r);
  });
});
