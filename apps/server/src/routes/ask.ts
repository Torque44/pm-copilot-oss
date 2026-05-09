// POST /api/ask  — ASKB-style Q&A grounded in the loaded market.
// Body:     { market: MarketMeta, question: string }
// Response: { events: AskEvent[], complete: boolean }
//
// Three abuse defenses keep the public-demo OpenAI bill from getting
// drained by bots running off-topic prompts ("solve 2+2", "write me code"):
//
//   1. Off-topic gate (free, runs first) — regex denylist for the obvious
//      non-market patterns. Hits return a canned refusal without calling
//      the LLM at all.
//   2. Per-IP sliding-window rate limit (free, runs second) — caps each
//      IP at 30 questions per rolling hour. Returns 429 once breached.
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
import { topTweetsForMarket } from '@pm-copilot/core/mcp/loaders/x-stub';
import { byokProvider } from '@pm-copilot/core/providers/byok';
import type {
  MarketMeta, BookGrounding, HoldersGrounding, NewsGrounding, AgentEvent, LLMProvider,
} from '@pm-copilot/core';

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

// ─────────────────────────────────────────────────────────────────────
// Per-IP sliding-window rate limit.
// ─────────────────────────────────────────────────────────────────────
// 30 questions per IP per rolling hour. In-memory; a future scale-out
// would need shared state (Redis), but for a single-replica Container
// App this is fine. Map prevents unbounded growth via lazy cleanup on
// every check call (entries with windows older than 2× window are
// dropped). Behind Container Apps' ingress the real client IP is in
// the `x-forwarded-for` header.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;   // 1 hour
const RATE_LIMIT_MAX_PER_WINDOW = 30;
const ipBuckets = new Map<string, number[]>(); // ip → [timestamps]

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0];
    if (first) return first.trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip: string): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const stamps = ipBuckets.get(ip)?.filter((t) => t > cutoff) ?? [];
  if (stamps.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    const oldest = stamps[0]!;
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(0, RATE_LIMIT_WINDOW_MS - (now - oldest)),
    };
  }
  stamps.push(now);
  ipBuckets.set(ip, stamps);
  // Lazy cleanup: every 200 inserts, sweep the map for fully-expired
  // entries so the map doesn't accumulate stale IPs forever.
  if (stamps.length === 1 && ipBuckets.size > 1000) {
    for (const [k, v] of ipBuckets) {
      if (!v.some((t) => t > cutoff)) ipBuckets.delete(k);
    }
  }
  return {
    ok: true,
    remaining: RATE_LIMIT_MAX_PER_WINDOW - stamps.length,
    retryAfterMs: 0,
  };
}

/** Response shape returned by POST /api/ask. The client iterates the
 *  events to build the chat message; an `ask:done` envelope holds the
 *  final structured answer (sections + citations). `complete: false`
 *  means the run errored partway through. */
export type AskResponse = {
  events: AskEvent[];
  complete: boolean;
};

/** Validate the body's market shape just enough to trust it for grounding fetches. */
function parseMarket(body: unknown): MarketMeta | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as { market?: unknown };
  const m = root.market;
  if (!m || typeof m !== 'object') return null;
  const cand = m as Partial<MarketMeta>;
  if (typeof cand.marketId !== 'string' || !cand.marketId) return null;
  if (typeof cand.tokenIdYes !== 'string' || typeof cand.tokenIdNo !== 'string') return null;
  return cand as MarketMeta;
}

/**
 * Ensure we have book/holders/news for the market. If the grounding store
 * already has them from a previous brief run, use that; otherwise fetch fresh.
 * This lets users ask questions immediately on a freshly-selected market even
 * before the brief finishes.
 */
async function ensureGrounding(
  market: MarketMeta,
  emit: (ev: AskEvent) => void
): Promise<{ book: BookGrounding | null; holders: HoldersGrounding | null; news: NewsGrounding | null }> {
  const existing = readGrounding(market.marketId);
  const have = {
    book: (existing?.book ?? null) as BookGrounding | null,
    holders: (existing?.holders ?? null) as HoldersGrounding | null,
    news: (existing?.news ?? null) as NewsGrounding | null,
  };
  // If all three are present, we're done.
  if (have.book && have.holders && have.news) return have;

  emit({ t: 'ask:progress', message: 'fetching grounding (book / holders / news)…' });

  // Swallow supervisor-style events silently; we only need the raw groundings.
  const silent = (_ev: AgentEvent) => { /* drop */ };
  const ctx = { market, emit: silent };

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
  await Promise.all(tasks);

  return have;
}

export async function askHandler(req: Request, res: Response) {
  const market = parseMarket(req.body);
  const question = String(req.body?.question ?? '').trim();
  if (!market) {
    res.status(400).json({ error: 'request body must include { market: MarketMeta, question }' });
    return;
  }
  if (!question) {
    res.status(400).json({ error: 'question required' });
    return;
  }

  // ── Defense layer 1: per-IP rate limit ──
  // Cheap, runs before any LLM call. 30 questions per rolling hour per IP.
  // 429 with Retry-After header lets the client back off cleanly.
  const ip = clientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    const retryS = Math.ceil(rate.retryAfterMs / 1000);
    res.setHeader('Retry-After', String(retryS));
    res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX_PER_WINDOW));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.status(429).json({
      error: `rate limit exceeded — ${RATE_LIMIT_MAX_PER_WINDOW} questions per hour per IP. Retry in ${Math.ceil(retryS / 60)} minutes.`,
    });
    return;
  }
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX_PER_WINDOW));
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));

  // ── Defense layer 2: off-topic gate ──
  // Cheap, runs before any LLM call. Pure regex denylist for obvious
  // non-market questions (math homework, code generation, jokes, etc.).
  // Returns a canned single-claim refusal in the ask response shape so
  // the client renders it as a normal chat reply instead of a 4xx error.
  if (isOffTopic(question)) {
    console.info(`[ask] off-topic blocked from ${ip}: ${question.slice(0, 80)}`);
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

  // Collect every emitted event into an array. The final ask:done envelope
  // (or ask:error if it failed) holds the structured answer the client
  // renders in the chat panel.
  const events: AskEvent[] = [];
  const emit = (ev: AskEvent) => { events.push(ev); };

  let complete = true;
  try {
    const grounding = await ensureGrounding(market, emit);
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
    // Pick the best provider for ask: prefer a web-search-capable one so we
    // can answer factual questions whose data isn't already in the brief
    // grounding ("how did Antonelli win the last race"). Priority:
    //   1. perplexity (when user adds a Perplexity key — native web search)
    //   2. xAI / Grok (the user's own setup — live_search is auto-enabled in
    //      runAsk via the webSearch capability flag)
    //   3. primary (OpenAI today — answers from grounding only, honest about
    //      data gaps when grounding doesn't cover the question)
    const routing = byokProvider(req.byok ?? {});
    let askProvider: LLMProvider | null = null;
    if (routing.news.capabilities?.webSearch) askProvider = routing.news;          // perplexity
    else if (routing.sentiment?.capabilities?.webSearch) askProvider = routing.sentiment; // xai
    // else fall through to primary via getProvider() inside runAsk
    await runAsk(market, { ...grounding, tweets }, question, emit, askProvider);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'ask failed';
    events.push({ t: 'ask:error', error: msg, elapsedMs: 0 });
    complete = false;
  }

  const body: AskResponse = { events, complete };
  res.json(body);
}
