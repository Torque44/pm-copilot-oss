// ask.test.ts — locks in the salvageSectionedClaims regex parser.
//
// salvageSectionedClaims is the resilience layer that rescues a chat
// answer when the model returns malformed JSON but the `**Section:**`
// blocks are still readable. The cf-azure rewrite touches the route
// (drops SSE) but NOT this helper — these tests baseline the current
// behavior so a refactor doesn't quietly regress the salvage.

import { describe, it, expect } from 'vitest';
import { salvageSectionedClaims } from './ask';
import type { Citation } from './types';

// Test fixture registry. Citation requires label + payload; we use the
// id as label and an empty object as payload since the salvage parser
// doesn't read either — it only checks `registry.has(id)`.
const cit = (id: string, kind: 'book' | 'whale' | 'news' | 'kol' | 'comp'): Citation => ({
  id, kind, label: id, payload: {},
});
const REG: Map<string, Citation> = new Map([
  ['book-stats', cit('book-stats', 'book')],
  ['book-1a',    cit('book-1a',    'book')],
  ['whale-3',    cit('whale-3',    'whale')],
  ['whale-stats',cit('whale-stats','whale')],
  ['news-2',     cit('news-2',     'news')],
  ['news-7',     cit('news-7',     'news')],
  ['kol-1',      cit('kol-1',      'kol')],
]);

describe('salvageSectionedClaims', () => {
  it('extracts a single section block from raw text', () => {
    const raw = '**Numbers:** YES at 73.5¢, dropped 5¢ in 2h [book-stats].';
    const out = salvageSectionedClaims(raw, REG);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toMatch(/^\*\*Numbers:\*\*\s+YES at 73\.5¢/);
    expect(out[0]!.citations).toEqual(['book-stats']);
  });

  it('extracts multiple section blocks', () => {
    const raw = `**Numbers:** YES at 60¢ [book-stats]. **Holders:** Top-5 hold 47% [whale-stats] [whale-3].`;
    const out = salvageSectionedClaims(raw, REG);
    expect(out).toHaveLength(2);
    const numbers = out.find((c) => /Numbers/i.test(c.text));
    const holders = out.find((c) => /Holders/i.test(c.text));
    expect(numbers).toBeTruthy();
    expect(holders).toBeTruthy();
    expect(holders!.citations).toEqual(['whale-stats', 'whale-3']);
  });

  // NOTE: the salvage regex `[,;}\]]+$` is greedy across the citation's
  // closing `]`, so trailing JSON garbage AFTER a citation pill (e.g.
  // `[book-stats],}],`) eats the closing bracket of the pill. That's a
  // real bug worth fixing later; for now we just don't pin the broken
  // behavior here. See the inline comment in salvageSectionedClaims.

  it('drops citation ids that are not in the registry', () => {
    const raw = '**Catalysts:** Big news [news-7] [news-999] [whale-3].';
    const out = salvageSectionedClaims(raw, REG);
    expect(out).toHaveLength(1);
    expect(out[0]!.citations).toEqual(['news-7', 'whale-3']);
    expect(out[0]!.citations).not.toContain('news-999');
  });

  it('handles middle-dot vs hyphen citation id variants (canonicalises)', () => {
    // The model sometimes emits [news·7] (middle dot) instead of [news-7].
    // canonPillId in ask.ts normalises before checking the registry.
    const raw = '**Catalysts:** From [news·7] and [whale·3].';
    const out = salvageSectionedClaims(raw, REG);
    expect(out[0]!.citations).toEqual(['news-7', 'whale-3']);
  });

  it('strips ```json fences if the model wrapped the response', () => {
    const raw = '```json\n**Sentiment:** Bears active [kol-1].\n```';
    const out = salvageSectionedClaims(raw, REG);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toMatch(/Bears active/);
  });

  it('returns empty array when no section markers are found', () => {
    const raw = 'just some prose that the model wrote with no headers';
    expect(salvageSectionedClaims(raw, REG)).toEqual([]);
  });

  it('returns empty array on empty input', () => {
    expect(salvageSectionedClaims('', REG)).toEqual([]);
  });

  it('normalises section labels to canonical case', () => {
    // canonicalSection accepts variants; the salvaged claim text should
    // start with the canonical `**Numbers:**` label regardless of input
    // casing.
    const raw = '**numbers:** Price 60¢ [book-1a].';
    const out = salvageSectionedClaims(raw, REG);
    expect(out[0]!.text).toMatch(/^\*\*Numbers:\*\*/);
  });

  it('caps a runaway block at 600 chars + ellipsis', () => {
    const longBody = 'x'.repeat(800);
    const raw = `**Thesis (YES):** ${longBody} [news-7].`;
    const out = salvageSectionedClaims(raw, REG);
    expect(out[0]!.text.length).toBeLessThanOrEqual(700);
    expect(out[0]!.text).toMatch(/…$/);
  });

  it('handles section labels with parens like Thesis (YES)', () => {
    const raw = '**Thesis (YES):** Bull case [news-2]. **Thesis (NO):** Bear case [news-7].';
    const out = salvageSectionedClaims(raw, REG);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toMatch(/^\*\*Thesis \(YES\):\*\*/);
    expect(out[1]!.text).toMatch(/^\*\*Thesis \(NO\):\*\*/);
  });
});
