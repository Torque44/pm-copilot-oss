// external.test.ts — locks in the buildSubprocessEnv allowlist behavior so
// an MCP subprocess can't inherit provider keys / admin tokens by default.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildSubprocessEnv } from './external';
import type { MCPServerConfig } from '../types';

function mkCfg(over: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    name: 'test',
    venues: ['polymarket'],
    scopes: ['orderbook'],
    transport: 'stdio',
    command: 'node',
    args: [],
    ...over,
  };
}

describe('buildSubprocessEnv', () => {
  beforeEach(() => {
    vi.stubEnv('PATH', '/usr/bin:/bin');
    vi.stubEnv('HOME', '/home/test');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-leak-1234');
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-leak-5678');
    vi.stubEnv('ADMIN_TOKEN', 'admin-secret-token');
    vi.stubEnv('EXA_API_KEY', 'exa-key-xyz');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does NOT pass provider keys to the subprocess by default', () => {
    const env = buildSubprocessEnv(mkCfg());
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['EXA_API_KEY']).toBeUndefined();
  });

  it('does NOT pass ADMIN_TOKEN to the subprocess by default', () => {
    const env = buildSubprocessEnv(mkCfg());
    expect(env['ADMIN_TOKEN']).toBeUndefined();
  });

  it('does pass PATH and HOME (subprocess needs them to function)', () => {
    const env = buildSubprocessEnv(mkCfg());
    expect(env['PATH']).toBe('/usr/bin:/bin');
    expect(env['HOME']).toBe('/home/test');
  });

  it('passes explicitly-declared cfg.env vars', () => {
    const env = buildSubprocessEnv(mkCfg({
      env: { MY_MCP_KEY: 'narrow-scoped-secret' },
    }));
    expect(env['MY_MCP_KEY']).toBe('narrow-scoped-secret');
  });

  it('cfg.env wins over allowlist defaults on key collision', () => {
    const env = buildSubprocessEnv(mkCfg({
      env: { PATH: '/custom/path' },
    }));
    expect(env['PATH']).toBe('/custom/path');
  });

  it('inheritEnv:true passes the full parent env (opt-in)', () => {
    const env = buildSubprocessEnv(mkCfg({ inheritEnv: true }));
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-leak-1234');
    expect(env['ADMIN_TOKEN']).toBe('admin-secret-token');
  });

  it('inheritEnv:true still lets cfg.env override', () => {
    const env = buildSubprocessEnv(mkCfg({
      inheritEnv: true,
      env: { ANTHROPIC_API_KEY: 'override-key' },
    }));
    expect(env['ANTHROPIC_API_KEY']).toBe('override-key');
  });
});
