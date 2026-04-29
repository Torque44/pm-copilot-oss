// X-stub feed — pre-curated KOL tweets bundled with the repo so the
// Sentiment agent has input even before a real X-actions MCP is registered.
//
// Production users supplying an MCP server registered for venue=x scope=news
// (or sentiment) will override at runtime; until then this stub returns the
// top-N most-relevant tweets by simple keyword overlap with the market
// title.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type StubTweet = {
  handle: string;
  text: string;
  url: string;
  createdAt: string;
  topics?: string[];
};

let cached: StubTweet[] | null = null;

function loadAll(): StubTweet[] {
  if (cached) return cached;
  try {
    const raw = readFileSync(join(__dirname, 'x-stub-data.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    cached = Array.isArray(parsed) ? (parsed as StubTweet[]) : [];
  } catch {
    cached = [];
  }
  return cached;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'of',
  'on', 'or', 'the', 'to', 'will', 'with', 'when', 'what', 'how', 'who',
  'has', 'have', 'do', 'does', 'did', 'this', 'that', 'these', 'those',
  'next', 'first', 'last', 'price', 'market',
]);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9·\-\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w)),
  );
}

function scoreTweet(t: StubTweet, queryTokens: Set<string>): number {
  const tokens = tokenize(t.text);
  if (Array.isArray(t.topics)) for (const tag of t.topics) tokens.add(tag.toLowerCase());
  let score = 0;
  for (const q of queryTokens) {
    if (tokens.has(q)) score += 1;
    // partial match on numeric tokens (150k matches "150k")
    if (q.length >= 3 && [...tokens].some((tok) => tok.includes(q))) score += 0.5;
  }
  return score;
}

/**
 * Return the top N tweets matched by simple keyword overlap with the market
 * title. Returns an empty array if nothing scores > 0; the sentiment agent
 * handles the empty case gracefully.
 */
export function topTweetsForMarket(marketTitle: string, n = 10): StubTweet[] {
  const all = loadAll();
  if (all.length === 0) return [];
  const queryTokens = tokenize(marketTitle);
  if (queryTokens.size === 0) return [];

  return all
    .map((t) => ({ t, score: scoreTweet(t, queryTokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.t);
}
