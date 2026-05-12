// news-cache.test.ts — singleton invariant.

import { describe, it, expect } from 'vitest';
import { getNewsCache } from './news-cache';

describe('news cache singleton', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getNewsCache();
    const b = getNewsCache();
    expect(a).toBe(b);
  });
});
