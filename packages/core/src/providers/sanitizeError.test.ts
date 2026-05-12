// sanitizeError.test.ts — locks in the key-fragment redaction so an
// upstream gateway can't smuggle a key prefix into our logs or responses.

import { describe, it, expect } from 'vitest';
import {
  sanitizeProviderError,
  redactKeyFragments,
  sanitizeUpstreamErrorBody,
} from './sanitizeError';

describe('sanitizeProviderError', () => {
  it('returns "unknown" for falsy input', () => {
    expect(sanitizeProviderError('')).toBe('unknown');
    expect(sanitizeProviderError(undefined)).toBe('unknown');
  });

  it('buckets 401/403 into auth-failed', () => {
    expect(sanitizeProviderError('HTTP 401 invalid_api_key')).toMatch(/auth failed/);
    expect(sanitizeProviderError('403 forbidden')).toMatch(/auth failed/);
  });

  it('buckets 429 into rate-limited', () => {
    expect(sanitizeProviderError('429 rate limit exceeded')).toMatch(/rate limited/);
  });

  it('catch-all is "provider error"', () => {
    expect(sanitizeProviderError('weird vendor stack trace lol')).toBe('provider error');
  });
});

describe('redactKeyFragments', () => {
  it('redacts Anthropic sk-ant- keys', () => {
    expect(redactKeyFragments('error: sk-ant-api03-AbCdEf12345 invalid'))
      .toBe('error: [REDACTED] invalid');
  });

  it('redacts OpenAI sk- keys', () => {
    expect(redactKeyFragments('Incorrect API key: sk-test-1234567890abcd'))
      .toBe('Incorrect API key: [REDACTED]');
  });

  it('redacts Perplexity pplx- keys', () => {
    expect(redactKeyFragments('auth failed pplx-AbCdEf12345678 bad'))
      .toBe('auth failed [REDACTED] bad');
  });

  it('redacts xAI xai- keys', () => {
    expect(redactKeyFragments('check key xai-1234567890abcd format'))
      .toBe('check key [REDACTED] format');
  });

  it('redacts Google AIza keys', () => {
    expect(redactKeyFragments('AIzaSyB-1234567890abcdefghij is bad'))
      .toBe('[REDACTED] is bad');
  });

  it('redacts Bearer tokens', () => {
    expect(redactKeyFragments('Authorization: Bearer abc1234567890xyz failed'))
      .toBe('Authorization: Bearer [REDACTED] failed');
  });

  it('redacts JWT-shaped tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4';
    expect(redactKeyFragments(`token=${jwt} expired`)).toBe('token=[REDACTED] expired');
  });

  it('leaves benign error strings untouched', () => {
    expect(redactKeyFragments('rate limit exceeded, retry in 60s'))
      .toBe('rate limit exceeded, retry in 60s');
  });
});

describe('sanitizeUpstreamErrorBody', () => {
  it('combines redaction + truncation', () => {
    const long = 'A'.repeat(500) + ' sk-test-1234567890abcdef end';
    const out = sanitizeUpstreamErrorBody(long, 100);
    expect(out.length).toBe(100);
    expect(out).not.toContain('sk-test-');
  });

  it('returns empty for empty input', () => {
    expect(sanitizeUpstreamErrorBody('')).toBe('');
    expect(sanitizeUpstreamErrorBody(undefined)).toBe('');
  });
});
