// MatchAgent — produces a Pregame Brief for a single soccer fixture (not a
// Polymarket market). Uses the active provider + WebSearch to ground the brief
// in real recent form, head-to-head, and news. Single LLM call, 4 sections.
//
// This runs when the user clicks a game row in the Recent Results rail.
// Polymarket-native briefs still use the supervisor in supervisor.ts.

import { getProvider } from '../providers/index';
import { extractJson } from '../providers/types';
import type {
  AgentEvent,
  BriefSectionName,
  Citation,
  Claim,
} from './types';

export type FixtureInput = {
  league: 'La Liga' | 'UCL' | string;
  homeTeam: string;
  awayTeam: string;
  date: string;                    // ISO
  status: 'final' | 'live' | 'scheduled';
  homeScore?: number | null;
  awayScore?: number | null;
  espnLink?: string;
};

export type MatchBrief = {
  fixture: FixtureInput;
  sections: {
    setup: Claim[];
    form: Claim[];
    storylines: Claim[];
    verdict: Claim[];
  };
  citations: Citation[];
  edge: 'home' | 'away' | 'draw' | 'unclear';
  confidence: 'high' | 'med' | 'low';
};

export type MatchBriefSection = 'setup' | 'form' | 'storylines' | 'verdict';

export type MatchEvent =
  | { t: 'agent:start'; agent: 'match' }
  | { t: 'agent:progress'; agent: 'match'; message: string }
  | { t: 'agent:done'; agent: 'match'; elapsedMs: number }
  | { t: 'agent:error'; agent: 'match'; error: string; elapsedMs: number }
  | { t: 'match:section'; name: MatchBriefSection; claims: Claim[] }
  | { t: 'match:complete'; brief: MatchBrief }
  | { t: 'error'; error: string };

const SYS = `You are PM Copilot, producing a Pregame Brief for a single soccer fixture.

You will be given: league, home team, away team, kickoff date, and current status/score.
Use the WebSearch tool to pull recent form, head-to-head, and key storylines (team news, injuries, tactical angles, line movements if available).

Produce a four-section brief:
1. SETUP (1–2 short claims): teams, kickoff, league context. No speculation.
2. FORM & H2H (2–4 claims): last 3–5 results for each team AND head-to-head recent history. Every claim MUST cite at least one [news·N] where N is the 1-indexed source you used. Use specific results ("Real Madrid lost 4-3 at Bayern last week") not vague prose ("Real Madrid in poor form").
3. STORYLINES (2–3 claims): injuries, suspensions, lineup news, title/relegation implications, manager news. Each claim cites a [news·N].
4. VERDICT (1 claim): your take. State who has the edge ("home", "away", "draw") and confidence ("low", "med", "high"). Cite at least two [news·N]. If the match is already FINAL, write a POST-MATCH verdict explaining what decided the result.

Return JSON EXACTLY matching this shape:
{
  "sources": [
    { "headline": "...", "source": "...", "url": "...", "snippet": "..." }
  ],
  "sections": {
    "setup":      [{ "text": "...", "citations": [] }],
    "form":       [{ "text": "...", "citations": ["news·1", "news·2"] }],
    "storylines": [{ "text": "...", "citations": ["news·3"] }],
    "verdict":    [{ "text": "...", "citations": ["news·1", "news·2"] }]
  },
  "edge": "home" | "away" | "draw" | "unclear",
  "confidence": "low" | "med" | "high"
}

Rules:
- sources[] should have 3–6 entries. Each MUST have a real URL returned by WebSearch.
- Every [news·N] in citations must correspond to a sources[N-1] index.
- No made-up scores. No made-up injury reports. If you can't find something, say so briefly.
- Verdict must commit to an edge and confidence — don't hedge to "unclear/low" unless data is genuinely absent.`;

type MatchResp = {
  sources?: Array<{ headline: string; source: string; url: string; snippet?: string; publishedAt?: string }>;
  sections?: Partial<Record<MatchBriefSection, Claim[]>>;
  edge?: string;
  confidence?: string;
};

export async function runMatchBrief(
  fixture: FixtureInput,
  emit: (ev: MatchEvent) => void
): Promise<MatchBrief> {
  const started = Date.now();
  emit({ t: 'agent:start', agent: 'match' });

  const resolvedScore =
    fixture.status === 'final' && fixture.homeScore != null && fixture.awayScore != null
      ? `Final: ${fixture.awayTeam} ${fixture.awayScore} @ ${fixture.homeTeam} ${fixture.homeScore}`
      : fixture.status === 'live'
      ? `LIVE: ${fixture.awayTeam} ${fixture.awayScore ?? 0} @ ${fixture.homeTeam} ${fixture.homeScore ?? 0}`
      : 'Kickoff pending';

  const prompt = `League: ${fixture.league}
Home: ${fixture.homeTeam}
Away: ${fixture.awayTeam}
Kickoff (UTC): ${fixture.date}
Status: ${fixture.status}
${resolvedScore}

Search the web for recent form, head-to-head, and storylines, then return the JSON brief.`;

  emit({ t: 'agent:progress', agent: 'match', message: 'searching form, H2H, and team news…' });

  const provider = getProvider();
  const allowedTools = provider.capabilities.webSearch ? ['WebSearch'] : [];
  const res = await provider.complete(prompt, {
    tier: 'reasoning',
    systemPrompt: SYS,
    allowedTools,
    jsonOnly: true,
    timeoutMs: 180_000,   // WebSearch + structured synthesis routinely pushes 60–90s
  });

  const parsed = res.ok ? extractJson<MatchResp>(res.text) : null;

  const sources = Array.isArray(parsed?.sources) ? parsed!.sources.slice(0, 6) : [];

  const citations: Citation[] = sources.map((s, i) => ({
    id: `news·${i + 1}`,
    kind: 'news' as const,
    label: `news·${i + 1}`,
    payload: {
      headline: s.headline ?? '',
      source: s.source ?? '',
      url: s.url ?? '',
      snippet: s.snippet ?? '',
    },
    url: s.url,
  }));

  const validIds = new Set(citations.map((c) => c.id));

  const normalise = (claims: Claim[] | undefined, fb: Claim[]): Claim[] => {
    if (!Array.isArray(claims) || !claims.length) return fb;
    const mapped = claims
      .map((c) => ({
        text: String(c?.text ?? '').trim(),
        citations: Array.isArray(c?.citations)
          ? Array.from(
              new Set(
                c.citations
                  .map((id) => String(id).replace(/[\[\]]/g, '').trim())
                  .filter((id) => validIds.has(id))
              )
            )
          : [],
      }))
      .filter((c) => c.text.length > 0);
    return mapped.length ? mapped : fb;
  };

  const setupFB: Claim[] = [
    {
      text:
        fixture.status === 'scheduled'
          ? `${fixture.awayTeam} travel to ${fixture.homeTeam} in ${fixture.league}, kicking off ${formatDate(fixture.date)}.`
          : fixture.status === 'live'
          ? `${fixture.awayTeam} at ${fixture.homeTeam} · live in ${fixture.league}.`
          : `${fixture.awayTeam} ${fixture.awayScore} @ ${fixture.homeTeam} ${fixture.homeScore} · ${fixture.league} · ${formatDate(fixture.date)}.`,
      citations: [],
    },
  ];

  const formFB: Claim[] = [
    { text: 'Form data unavailable — web search returned nothing usable.', citations: [] },
  ];
  const storyFB: Claim[] = [
    { text: 'No recent storylines surfaced.', citations: [] },
  ];
  const verdictFB: Claim[] = [
    {
      text:
        fixture.status === 'final'
          ? 'Post-match analysis unavailable.'
          : 'No clear edge — insufficient data surfaced.',
      citations: [],
    },
  ];

  const sections = {
    setup: normalise(parsed?.sections?.setup, setupFB),
    form: normalise(parsed?.sections?.form, formFB),
    storylines: normalise(parsed?.sections?.storylines, storyFB),
    verdict: normalise(parsed?.sections?.verdict, verdictFB),
  };

  // Fake-stream sections for UI liveness.
  const order: MatchBriefSection[] = ['setup', 'form', 'storylines', 'verdict'];
  for (const name of order) {
    emit({ t: 'match:section', name, claims: sections[name] });
    await sleep(170);
  }

  const edge = normaliseEnum(parsed?.edge, ['home', 'away', 'draw', 'unclear']) ?? 'unclear';
  const confidence = normaliseEnum(parsed?.confidence, ['high', 'med', 'low']) ?? 'low';

  const brief: MatchBrief = {
    fixture,
    sections,
    citations,
    edge: edge as MatchBrief['edge'],
    confidence: confidence as MatchBrief['confidence'],
  };

  emit({ t: 'match:complete', brief });
  emit({ t: 'agent:done', agent: 'match', elapsedMs: Date.now() - started });

  if (!res.ok) {
    emit({ t: 'agent:error', agent: 'match', error: res.error ?? 'unknown', elapsedMs: Date.now() - started });
  }

  return brief;
}

function normaliseEnum(val: unknown, allowed: string[]): string | null {
  if (typeof val !== 'string') return null;
  const v = val.trim().toLowerCase();
  return allowed.includes(v) ? v : null;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
