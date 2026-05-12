// supervisor.test.ts — locks in the resolved-market branch. When the
// MarketMeta has resolvedAt set, the supervisor must NOT emit start
// events for sentiment or thesis. The fanOut wave also must skip them
// — otherwise the agents would run, find nothing, and the model fills
// the gap with fabrication (exact bug we're fixing).

import { describe, it, expect, vi } from 'vitest';
import { runSupervisor } from './supervisor';
import type { AgentEvent, MarketMeta, AgentResult } from './types';
import type { LLMProvider } from '../providers/types';

// Mock all agent runners — supervisor is tested in isolation. Each mock
// resolves with a minimal AgentResult so the supervisor's fan-out/synthesis
// flow completes without touching the network.
const stubResult = (agent: AgentResult['agent']): AgentResult => ({
  agent,
  output: { claims: [], citations: [] },
  grounding: null,
  elapsedMs: 1,
});

vi.mock('./market', () => ({ runMarketAgent: vi.fn().mockImplementation(async () => stubResult('market')) }));
vi.mock('./holders', () => ({ runHoldersAgent: vi.fn().mockImplementation(async () => stubResult('holders')) }));
vi.mock('./news', () => ({ runNewsAgent: vi.fn().mockImplementation(async () => stubResult('news')) }));
vi.mock('./comparables', () => ({ runComparablesAgent: vi.fn().mockImplementation(async () => stubResult('comparables')) }));
vi.mock('./sentiment', () => ({ runSentimentAgent: vi.fn().mockImplementation(async () => stubResult('sentiment')) }));
vi.mock('./thesis', () => ({ runThesisAgent: vi.fn().mockImplementation(async () => stubResult('thesis')) }));
vi.mock('./synthesis', () => ({
  runSynthesis: vi.fn().mockImplementation(async () => ({
    output: { claims: [], citations: [] }, elapsedMs: 1,
  })),
}));

function mkResolvedMarket(over: Partial<MarketMeta> = {}): MarketMeta {
  return {
    marketId: 'm-1',
    title: 'Will X happen?',
    endDate: '2026-04-15T12:00:00Z',
    category: 'other',
    yes: 1.0,
    no: 0.0,
    volume24hr: 0,
    volumeTotal: 50_000,
    conditionId: '0xabc',
    tokenIdYes: 'tyes',
    tokenIdNo: 'tno',
    slug: 'will-x-happen',
    resolvedAt: '2026-04-15T12:00:00Z',
    ...over,
  };
}

function mkActiveMarket(over: Partial<MarketMeta> = {}): MarketMeta {
  return mkResolvedMarket({ resolvedAt: null, yes: 0.5, no: 0.5, ...over });
}

function stubProvider(): LLMProvider {
  return {
    name: 'openai',
    capabilities: { nativeJsonMode: false, webSearch: false, authViaSession: false },
    complete: vi.fn().mockResolvedValue({
      text: '{}',
      ok: true,
      elapsedMs: 1,
      model: 'stub',
      provider: 'openai',
    }),
  };
}

describe('runSupervisor — resolved-market branch', () => {
  it('does not emit start events for sentiment or thesis on resolved markets', async () => {
    const events: AgentEvent[] = [];
    const market = mkResolvedMarket();
    const provider = stubProvider();

    await runSupervisor({
      market,
      emit: (ev) => events.push(ev),
      routing: { primary: provider, news: provider, sentiment: provider },
    });

    const startEvents = events.filter((e) => e.t === 'agent:start').map((e) => e.agent);
    expect(startEvents).not.toContain('sentiment');
    expect(startEvents).not.toContain('thesis');
    expect(startEvents).toContain('market');
    expect(startEvents).toContain('news');
  });

  it('emits sentiment + thesis start on active markets (regression guard)', async () => {
    const events: AgentEvent[] = [];
    const market = mkActiveMarket();
    const provider = stubProvider();

    await runSupervisor({
      market,
      emit: (ev) => events.push(ev),
      routing: { primary: provider, news: provider, sentiment: provider },
    });

    const startEvents = events.filter((e) => e.t === 'agent:start').map((e) => e.agent);
    expect(startEvents).toContain('sentiment');
    expect(startEvents).toContain('thesis');
  });
});
