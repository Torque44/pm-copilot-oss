// POST /api/ask  — ASKB-style Q&A grounded in the loaded market.
// Body:     { market: MarketMeta, question: string }
// Response: { events: AskEvent[], complete: boolean }
//
// Three abuse defenses keep the public-demo OpenAI bill from getting
// drained by bots running off-topic prompts ("solve 2+2", "write me code"):
//
//   1. Per-IP sliding-window rate limit (free, applied as route middleware
//      in apps/server/src/index.ts) — caps each IP at 30 questions per
//      rolling hour via the shared rateLimit() util. Returns 429 once
//      breached, before the handler runs.
//   2. Off-topic gate (free, runs in-handler) — regex denylist for the
//      obvious non-market patterns. Hits return a canned refusal without
//      calling the LLM at all.
//   3. SYS prompt rule (cheap, runs last) — when 1 and 2 both pass and we
//      reach the LLM, the system prompt still tells the model to refuse
//      anything unrelated to prediction markets / trading / financial
//      analysis with a single sentence. Bounds the cost when an off-topic
//      question slips past the regex.
//
// History note: this route used to stream Server-Sent Events as the agents
// progressed. The cf-azure-rewrite (May 2026) dropped SSE in favour of a
// single synchronous JSON response. The supervisor still does the same
// work — it just emits into an in-memory array now and we return the array
// in one HTTP response.

import type { Request, Response } from 'express';
import { runAsk, type AskEvent } from '@pm-copilot/core/agents/ask';
import { readGrounding, rememberGrounding } from '../groundingStore.js';
import { runMarketAgent } from '@pm-copilot/core/agents/market';
import { runHoldersAgent } from '@pm-copilot/core/agents/holders';
import { runNewsAgent } from '@pm-copilot/core/agents/news';
import { runComparablesAgent, type ComparableHit } from '@pm-copilot/core/agents/comparables';
import { topTweetsForMarket } from '@pm-copilot/core/mcp/loaders/x-stub';
import { byokProvider, bestWebSearchProvider } from '@pm-copilot/core/providers/byok';
import {
  gammaToMarketMeta,
  getEventForMarketId,
  listEventsByTag,
  listEventsAll,
} from '@pm-copilot/core/feeds/polymarket';
import type {
  MarketMeta, BookGrounding, HoldersGrounding, NewsGrounding, AgentEvent, Category,
} from '@pm-copilot/core';
import { getCached as getCachedBrief, type BriefEnvelope } from '../briefStore.js';

// ─────────────────────────────────────────────────────────────────────
// Off-topic question gate — pre-LLM, regex-based, zero cost.
// ─────────────────────────────────────────────────────────────────────
// Patterns target the cheapest categories of abuse: math homework, code
// generation, general-assistant requests, "who are you" probing. We lean
// permissive on borderline trader questions (e.g. "what's a good entry
// point" sounds general but is on-topic). The SYS prompt's market-only
// rule is the second layer of defense for anything that slips past.
const OFF_TOPIC_PATTERNS: ReadonlyArray<RegExp> = [
  // Math homework: "solve x^2 + 3 = 0", "calculate 5*7", "what is 2+2"
  /\b(solve|simplify|factor(?:ize)?|differentiate|integrate|prove that)\b/i,
  /\bwhat\s+(?:is|are)\s+\d+\s*[+\-*/×÷]\s*\d+/i,
  /\b\d+\s*[+\-*/×÷]\s*\d+\s*=\s*\?+/,
  /\bquadratic|polynomial|derivative|antiderivative|trigonometr/i,
  // Code generation: "write a function", "in python", "hello world"
  /\b(write|generate|create|give\s+me)\s+(?:a\s+|some\s+)?(code|function|script|program|class|method|api|sql\s+query|regex)/i,
  /\b(in|using)\s+(python|javascript|typescript|java|c\+\+|c#|rust|golang|ruby|php|kotlin|swift|bash)\b/i,
  /\bhello[,\s]+world\b/i,
  /\bfibonacci|fizzbuzz|palindrome|two[\s-]?sum\b/i,
  // Creative / general assistant
  /\b(tell|say|write|compose|generate)\s+(?:me\s+)?(?:a|an|some)\s+(joke|poem|story|haiku|song|lyric|riddle|essay|letter|email|tweet)/i,
  /\b(?:good|nice)\s+recipe\s+for\b/i,
  /\b(weather|temperature|forecast)\s+(?:in|for|at)\s+\w+/i,
  /\b(translate|conjugate|spell\s+the\s+word)\b/i,
  // Self-referential / model probing
  /\bwho\s+are\s+you\b/i,
  /\bwhat\s+can\s+you\s+do\b/i,
  /\bwhat(?:'s|\s+is)\s+your\s+(name|purpose|model|version|prompt|instructions?)\b/i,
  /\bare\s+you\s+(an?\s+)?(ai|chatgpt|gpt[\s-]?[345]|claude|llama|robot|bot|sentient|conscious)\b/i,
  /\b(ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|your)\s+(instructions?|prompts?|rules?)\b/i,
  /\bsystem\s+prompt\b/i,
  // Personal / advice
  /\b(tell\s+me\s+(?:a\s+)?fun\s+fact|tell\s+me\s+about\s+yourself)\b/i,
];

const OFF_TOPIC_REFUSAL =
  'I only answer questions about this prediction market — pricing, holders, news, comparable markets, trade theses, or the broader macro/geopolitical context that would move the resolution. For other tasks, use a general assistant.';

function isOffTopic(question: string): boolean {
  for (const rx of OFF_TOPIC_PATTERNS) {
    if (rx.test(question)) return true;
  }
  return false;
}

/** Response shape returned by POST /api/ask. The client iterates the
 *  events to build the chat message; an `ask:done` envelope holds the
 *  final structured answer (sections + citations). `complete: false`
 *  means the run errored partway through. */
export type AskResponse = {
  events: AskEvent[];
  complete: boolean;
};

/** Extract the marketId from the body. Prefers a top-level `marketId`
 *  string (current clients); falls back to `body.market.marketId` for
 *  any pre-canonicalization client still in flight. The full `market`
 *  object the client may attach is IGNORED — we re-resolve canonical
 *  MarketMeta server-side via resolveCanonicalMarket() so a crafted
 *  caller can't inject a fake title/token through the agent prompts
 *  or poison the grounding cache. */
function parseMarketId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as { marketId?: unknown; market?: unknown };
  if (typeof root.marketId === 'string' && root.marketId) return root.marketId;
  if (root.market && typeof root.market === 'object') {
    const inner = (root.market as { marketId?: unknown }).marketId;
    if (typeof inner === 'string' && inner) return inner;
  }
  return null;
}

/** Resolve a marketId to canonical MarketMeta server-side. Same precedence
 *  as /api/brief:
 *    1. In-memory briefStore — instant if a recent brief ran for this id.
 *    2. Scan the four bucket lists (sports/crypto/politics/other) for
 *       a matching sub-market in any event.
 *    3. Final fallback: direct Gamma /markets?id= lookup with the parent
 *       event hydrated for category/title context.
 *  Returns null when no canonical metadata is available. */
async function resolveCanonicalMarket(marketId: string): Promise<MarketMeta | null> {
  // (1) briefStore cache: the very first envelope of a completed brief is
  // the canonical `{ t: 'market', market }` envelope written server-side.
  const cached = getCachedBrief(marketId);
  if (cached) {
    const marketEv = cached.events.find(
      (e): e is Extract<BriefEnvelope, { t: 'market' }> =>
        (e as { t?: string }).t === 'market',
    );
    if (marketEv?.market) return marketEv.market;
  }

  // (2) Bucket scans — same shape as brief.ts:resolveMarketById. The list
  // endpoints are themselves cached so repeated asks are cheap.
  const buckets: { cat: Category; fetch: () => Promise<Awaited<ReturnType<typeof listEventsByTag>>> }[] = [
    { cat: 'sports',   fetch: () => listEventsByTag('sports', 200) },
    { cat: 'crypto',   fetch: () => listEventsByTag('crypto', 200) },
    { cat: 'politics', fetch: () => listEventsByTag('politics', 200) },
    { cat: 'other',    fetch: () => listEventsAll(200) },
  ];
  for (const b of buckets) {
    try {
      const events = await b.fetch();
      for (const ev of events) {
        for (const m of ev.markets) {
          if (m.id !== marketId) continue;
          if (!m.clobTokenIds) return null;
          const meta = gammaToMarketMeta(ev, m, b.cat);
          if (!meta.tokenIdYes || !meta.tokenIdNo) return null;
          return meta;
        }
      }
    } catch {
      /* try the next bucket */
    }
  }

  // (3) Direct Gamma lookup (catches culture / pop-culture / niche-tag
  // markets that don't surface in the four bucket scans).
  try {
    const direct = await getEventForMarketId(marketId);
    if (!direct) return null;
    const { event, marketRaw } = direct;
    if (!marketRaw.clobTokenIds) return null;
    const meta = gammaToMarketMeta(event, marketRaw, 'other');
    if (!meta.tokenIdYes || !meta.tokenIdNo) return null;
    return meta;
  } catch {
    return null;
  }
}

/**
 * Ensure we have book/holders/news for the market. If the grounding store
 * already has them from a previous brief run, use that; otherwise fetch fresh.
 * This lets users ask questions immediately on a freshly-selected market even
 * before the brief finishes.
 */
async function ensureGrounding(
  market: MarketMeta,
  emit: (ev: AskEvent) => void,
  signal?: AbortSignal,
): Promise<{
  book: BookGrounding | null;
  holders: HoldersGrounding | null;
  news: NewsGrounding | null;
  comparables: ComparableHit[];
}> {
  const existing = readGrounding(market.marketId);
  const have = {
    book: (existing?.book ?? null) as BookGrounding | null,
    holders: (existing?.holders ?? null) as HoldersGrounding | null,
    news: (existing?.news ?? null) as NewsGrounding | null,
    comparables: [] as ComparableHit[],
  };
  const needComparables = true; // comparables aren't persisted via groundingStore today

  if (have.book && have.holders && have.news && !needComparables) return have;

  emit({ t: 'ask:progress', message: 'fetching grounding (book / holders / news / comparables)…' });

  // Swallow supervisor-style events silently; we only need the raw groundings.
  // Thread the route's abort signal so a client disconnect cancels in-flight
  // LLM calls inside market/holders/news agents instead of running to
  // completion (M8 contract — AgentContext.signal is optional).
  const silent = (_ev: AgentEvent) => { /* drop */ };
  const ctx = { market, emit: silent, ...(signal ? { signal } : {}) };

  const tasks: Promise<void>[] = [];
  if (!have.book) tasks.push(runMarketAgent(ctx).then((r) => {
    const g = r.grounding && r.grounding.kind === 'book' ? r.grounding : null;
    have.book = g;
    rememberGrounding(market.marketId, 'book', g);
  }).catch(() => { /* swallow */ }));
  if (!have.holders) tasks.push(runHoldersAgent(ctx).then((r) => {
    const g = r.grounding && r.grounding.kind === 'holders' ? r.grounding : null;
    have.holders = g;
    rememberGrounding(market.marketId, 'holders', g);
  }).catch(() => { /* swallow */ }));
  if (!have.news) tasks.push(runNewsAgent(ctx).then((r) => {
    const g = r.grounding && r.grounding.kind === 'news' ? r.grounding : null;
    have.news = g;
    rememberGrounding(market.marketId, 'news', g);
  }).catch(() => { /* swallow */ }));
  // Comparables fetch — deterministic HTTP, no LLM, ~200ms. Reads the
  // comparable citation payloads off the comparables agent's section output.
  // Without this, ask responses claimed "no past Polymarket resolution data"
  // even though the comparables agent had exactly that data on the brief side.
  //
  // ComparableHit gained optional `shape` and `description` fields in commits
  // a548f1e and 2a9d6c4 (the threshold-shape comparables work). The mapping
  // below is unchanged because the new fields ride on the same payload object
  // — they pass through structurally to AskComparable, which mirrors the
  // shape. runAsk's describeComparables() reads `shape` + `description` to
  // render per-comp threshold + realized-value rows when present, falling
  // back to plain-title rows otherwise.
  tasks.push(
    runComparablesAgent(ctx, { marketTitle: market.title, category: market.category })
      .then((r) => {
        have.comparables = r.output.citations
          .filter((c) => c.kind === 'comp' && c.payload)
          .map((c) => c.payload as ComparableHit)
          .filter((p) => p && typeof p.eventId === 'string' && typeof p.title === 'string');
      })
      .catch(() => { /* swallow */ }),
  );
  await Promise.all(tasks);

  return have;
}

export async function askHandler(req: Request, res: Response) {
  const marketId = parseMarketId(req.body);
  const question = String(req.body?.question ?? '').trim();
  if (!marketId) {
    res.status(400).json({ error: 'request body must include { marketId, question }' });
    return;
  }
  if (!question) {
    res.status(400).json({ error: 'question required' });
    return;
  }

  // ── Defense layer 1: off-topic gate ──
  // Cheap regex denylist for obvious non-market questions (math homework,
  // code generation, jokes, etc.). Runs BEFORE market resolution so an
  // off-topic spammer doesn't burn polymarket gamma cache lookups before
  // hitting the canned refusal. Returns the refusal in the ask response
  // shape so the client renders it as a normal chat reply.
  if (isOffTopic(question)) {
    // Log occurrence only — never include the question text itself, per
    // the no-LLM-content-in-logs policy.
    console.info(`[ask] off-topic blocked from ${req.ip || 'unknown'}`);
    const events: AskEvent[] = [
      { t: 'ask:start' },
      {
        t: 'ask:done',
        answer: {
          claims: [{ text: OFF_TOPIC_REFUSAL, citations: [] }],
          citations: [],
        },
        elapsedMs: 0,
      },
    ];
    res.json({ events, complete: true } satisfies AskResponse);
    return;
  }

  // Re-resolve canonical metadata server-side. The client's `market` object
  // (if attached for backward compat) is intentionally NOT trusted: agent
  // prompts use the canonical title and prices, the grounding store keys
  // off the canonical marketId, and any spoofed token IDs from a crafted
  // caller would never reach the supervisor.
  const market = await resolveCanonicalMarket(marketId);
  if (!market) {
    res.status(404).json({ error: `market ${marketId} not found` });
    return;
  }

  // Wire a route-level AbortController so a client disconnect (browser tab
  // close, network drop, navigation away) cancels in-flight LLM/HTTP work
  // instead of burning BYOK quota on an answer no one is reading. Brief
  // already does this (M8); ask was overlooked until codex's audit (H2).
  const abortCtrl = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) abortCtrl.abort();
  });

  // Collect every emitted event into an array. The final ask:done envelope
  // (or ask:error if it failed) holds the structured answer the client
  // renders in the chat panel.
  const events: AskEvent[] = [];
  const emit = (ev: AskEvent) => { events.push(ev); };

  let complete = true;
  try {
    const grounding = await ensureGrounding(market, emit, abortCtrl.signal);
    // Pull in the bundled stub tweets so questions about "vetted X handles
    // posting on this market" get a non-empty answer. xactions / live-search
    // would override this at registration time; for now this is the canonical
    // chat-side source of [kol-N] citations.
    const tweets = topTweetsForMarket(market.title, 10).map((t) => ({
      handle: t.handle,
      text: t.text,
      url: t.url,
      createdAt: t.createdAt,
    }));
    // Pick the best provider for ask: prefer a web-search-capable one so
    // we can answer factual questions whose data isn't already in brief
    // grounding ("how did Antonelli win the last race"). Falls back to
    // the global default (routing.primary) inside runAsk when nothing
    // web-search-capable is configured. See bestWebSearchProvider for the
    // priority rules (perplexity > xai > null).
    const routing = byokProvider(req.byok ?? {});
    const askProvider = bestWebSearchProvider(routing);
    // Pass comparables (resolved-market base-rate anchors) alongside book /
    // holders / news / tweets so the ask agent can answer "past Polymarket
    // resolution data" questions directly via [comp-N] citations instead of
    // refusing with "I don't have access to that".
    await runAsk(
      market,
      { ...grounding, tweets, comparables: grounding.comparables },
      question,
      emit,
      askProvider,
      abortCtrl.signal,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'ask failed';
    events.push({ t: 'ask:error', error: msg, elapsedMs: 0 });
    complete = false;
  }

  // Skip writing the response if the client already disconnected — Express
  // would log an "Cannot set headers after they are sent" or write to a
  // closed socket otherwise.
  if (res.writableEnded || abortCtrl.signal.aborted) return;
  const body: AskResponse = { events, complete };
  res.json(body);
}
