// synthesis.test.ts — locks in the citation canonicalisation fix.
//
// Bug: upstream agents emit mid-dot IDs (`whale·1`); the inline-pill regex
// produces hyphen-lowercase form (`whale-1`). validIds was built with the
// mid-dot form, then compared against the canon'd hyphen form, so every
// real pill in claim text got its brackets stripped. The fix canonicalises
// both citation IDs and claim references to the hyphen-lowercase form so
// the comparisons agree.

import { describe, it, expect } from 'vitest';
import { canonCitationId } from './synthesis';

describe('canonCitationId', () => {
  it('lowercases and converts mid-dot to hyphen', () => {
    expect(canonCitationId('Whale·1')).toBe('whale-1');
    expect(canonCitationId('NEWS·12')).toBe('news-12');
    expect(canonCitationId('book·3a')).toBe('book-3a');
  });

  it('strips surrounding brackets', () => {
    expect(canonCitationId('[whale·1]')).toBe('whale-1');
    expect(canonCitationId('[ news·2 ]')).toBe('news-2');
  });

  it('is idempotent on already-canonical IDs', () => {
    expect(canonCitationId('whale-1')).toBe('whale-1');
    expect(canonCitationId('news-12')).toBe('news-12');
  });

  it('handles multi-dot IDs (kol·1 etc)', () => {
    expect(canonCitationId('kol·1')).toBe('kol-1');
    expect(canonCitationId('comp·42')).toBe('comp-42');
  });
});
