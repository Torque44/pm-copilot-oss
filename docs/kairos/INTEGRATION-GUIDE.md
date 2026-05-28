# pmcopilot API — Kairos Integration Guide

**Version:** 1.0.0-rc1
**Spec:** [`openapi.yaml`](./openapi.yaml) (OpenAPI 3.1)
**Source:** github.com/Torque44/pm-copilot-oss
**Contact:** AJ — `ayushya2002@gmail.com` / `@torque44` / Telegram

---

## What this is

A REST API that exposes pmcopilot's research agents (thesis, comparables, news, sentiment, holders, resolution, Q&A, full research) anchored to a specific market. Designed to slot into Kairos's existing Research and News panels without you rebuilding the agent layer.

Eleven endpoints. One auth header. JSON in, JSON out. No streams in v1.

---

## Base URLs

| Environment | URL | Notes |
|---|---|---|
| Production | `https://api.pmcopilot.wtf/v1` | TLS 1.2+, US-east-1 |
| Staging    | `https://staging.api.pmcopilot.wtf/v1` | Same payload shapes, lower SLA |
| Sandbox (dev) | `https://dev.api.pmcopilot.wtf/v1` | Cached responses, free for integration testing |

For local development against your own checkout: `http://localhost:8787/v1` (run `pnpm dev` in `apps/server`).

---

## Authentication

Every request must include the `X-Api-Key` header.

```
X-Api-Key: kairos_prod_<hex>
```

Keys are scoped to a single environment. We'll issue you three on day 1 — one for each env. Treat them like database passwords; rotate on compromise.

`/v1/health` is the only endpoint that does not require an API key (it's used by health checkers and dashboards).

### Errors

| Status | `error` | Meaning |
|---|---|---|
| 400 | `bad_request` | Malformed request body or missing required field |
| 401 | `missing_api_key` | No `X-Api-Key` header sent |
| 401 | `invalid_api_key` | Header sent but not recognised |
| 404 | `not_found` | Market id does not exist on Polymarket (or has been delisted) |
| 429 | rate-limit body | See `Retry-After` header |
| 502 | `upstream_failure` | Polymarket Gamma or LLM provider returned an error; safe to retry |

Every error response carries `error` (stable code) + `message` (human-readable). Production responses also carry `request_id` for support correlation.

---

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | Service liveness |
| GET | `/markets/{market_id}` | Market metadata |
| GET | `/markets/{market_id}/outcomes` | Multi-resolution outcomes |
| GET | `/markets/{market_id}/holders` | Top holders + behavior tags |
| GET | `/markets/{market_id}/news` | Market-tagged news |
| GET | `/markets/{market_id}/sentiment` | Sentiment score + sources |
| GET | `/markets/{market_id}/thesis?counter=true` | Thesis (+ optional counter-thesis) |
| GET | `/markets/{market_id}/comparables` | Threshold-shape comparable markets |
| GET | `/markets/{market_id}/resolution` | Resolution criteria + realized value |
| POST | `/ask` | Single-turn Q&A with market context |
| POST | `/research` | Full multi-agent envelope (everything above in one call) |

Full payload schemas live in [`openapi.yaml`](./openapi.yaml). Below: just enough to integrate.

---

## Quickstart

### 1. Liveness probe

```bash
curl https://api.pmcopilot.wtf/v1/health
```

```json
{
  "ok": true,
  "service": "pm-copilot",
  "version": "1.0.0-rc1",
  "uptime_s": 38421.6
}
```

### 2. Get market metadata

```bash
curl https://api.pmcopilot.wtf/v1/markets/0xabc123… \
  -H "X-Api-Key: $KAIROS_API_KEY"
```

```json
{
  "market_id": "0xabc123…",
  "title": "Will the Federal Reserve cut rates 0 times in 2026?",
  "category": "finance",
  "status": "open",
  "venue": "polymarket",
  "oracle": "UMA",
  "yes_price_cents": 63.3,
  "no_price_cents": 36.7,
  "volume_usd": 217000,
  "liquidity_usd": 89200,
  "ends_at": "2026-12-31T23:59:00-05:00",
  "ends_at_timezone": "ET"
}
```

### 3. Get auto-generated thesis (with counter-thesis)

```bash
curl "https://api.pmcopilot.wtf/v1/markets/0xabc…/thesis?counter=true" \
  -H "X-Api-Key: $KAIROS_API_KEY"
```

```json
{
  "market_id": "0xabc…",
  "thesis": {
    "verdict": "buy_no",
    "edge_pp": 14,
    "confidence": 0.68,
    "summary": "…one-paragraph thesis…",
    "bull_case": "…",
    "bear_case": "…",
    "sections": [
      { "title": "Fundamental Analysis", "body": "…" },
      { "title": "News & Events", "body": "…" }
    ],
    "citations": [{ "id": "c1", "url": "…", "source": "Reuters", "quote": "…" }]
  },
  "counter_thesis": { … },
  "generated_at": "2026-05-24T20:14:00Z"
}
```

### 4. Q&A grounded in a market

```bash
curl https://api.pmcopilot.wtf/v1/ask \
  -X POST \
  -H "X-Api-Key: $KAIROS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "market_id": "0xabc…",
    "question": "What would have to happen for YES to resolve by year-end?"
  }'
```

### 5. Full research envelope (single call, everything)

```bash
curl https://api.pmcopilot.wtf/v1/research \
  -X POST \
  -H "X-Api-Key: $KAIROS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "market_id": "0xabc…",
    "include_counter_thesis": true,
    "include_holders": true,
    "include_news": true,
    "max_news_items": 10,
    "max_comparables": 5
  }'
```

Single response carries market, outcomes, holders, news, sentiment, thesis, counter-thesis, comparables, resolution. Use this for the bulk Research-panel render; use individual endpoints for incremental loads.

---

## Mapping to Kairos's existing panels

| Kairos panel | pmcopilot endpoint(s) | Notes |
|---|---|---|
| Order Books | none — pmcopilot does not compete with execution data | Keep yours |
| Top Holders (Trades sub-tab) | `/markets/{id}/holders` | Adds behavior tags (whale / sniper / market_maker / fresh_wallet / event_correlated) |
| Outcomes | `/markets/{id}/outcomes` | Multi-resolution markets get sub-market breakdown |
| Resolution | `/markets/{id}/resolution` | Realized value when applicable (tweet counts, weather, etc.) |
| Catalysts / News | `/markets/{id}/news` | Replaces tag-based ingest. Each article anchored to specific market via relevance score. |
| Thesis | `/markets/{id}/thesis` | Net-new — auto-generated thesis with citations |
| Sentiment | `/markets/{id}/sentiment` | Net-new — sentiment scoring across social + news |
| Comparable markets | `/markets/{id}/comparables` | Net-new — threshold-shape matching surfaces historically similar markets |
| Research panel (Q&A) | `/ask` | Net-new — market-anchored Q&A |
| Bulk panel render | `/research` | One call returns everything above |

---

## Rate limits

Per environment key, per IP:

| Endpoint group | Limit |
|---|---|
| `/health` | unlimited |
| `GET /markets/*` (metadata, outcomes, resolution) | 600 / hr |
| `GET /markets/*/holders`, `/news`, `/sentiment`, `/thesis`, `/comparables` | 120 / hr |
| `POST /ask`, `POST /research` | 30 / hr |

Hit a limit and you'll get a 429 with `Retry-After: <seconds>`. We'll bump these on request — the defaults are sized for honest browse-and-drill, not bulk indexing.

For a Kairos-style live panel render, prefer `/research` (one call, all data) over fan-out to individual endpoints — cheaper to cache, easier to reason about.

---

## Caching

pmcopilot's server caches market metadata for 5 min, thesis/research output for 15 min, and news for 10 min. Hits are served from memory and do not count against your rate limit.

You should also cache on your end. The `Cache-Control` header on each response indicates the freshness window we recommend.

---

## Sandbox env

`https://dev.api.pmcopilot.wtf/v1` is freely available for integration testing. Same payload shapes, no rate limit, responses cached aggressively (24h) so you'll see the same payload on repeat calls — great for snapshot-testing your panels against deterministic responses.

When you're ready to point at staging or prod, just swap the base URL — no payload changes.

---

## Versioning + deprecation

URL prefix is `/v1`. Breaking changes ship as `/v2` with at least 90 days of co-existence. Additive changes (new fields, new endpoints) ship within `/v1` without warning — your client must ignore unknown fields. We follow the OpenAPI 3.1 contract; any divergence from the spec is a bug, report it.

Deprecations get a `Deprecation: <date>` header on the response 30 days before sunset.

---

## Integration plan (suggested for Zayd)

**Week 1**
- [ ] Codegen client from `openapi.yaml` (we recommend `openapi-typescript` or `openapi-generator`)
- [ ] Wire `/v1/health` into your existing health-check dashboard
- [ ] Implement the `X-Api-Key` header injection in your HTTP client
- [ ] Smoke-test `/markets/{id}` against 3-5 markets you already render

**Week 2**
- [ ] Replace Catalysts / News ingest with `/markets/{id}/news` — biggest immediate win, removes the Iranian-state-media-on-tennis bug
- [ ] Wire `/markets/{id}/thesis` into the Research panel
- [ ] Wire `/markets/{id}/sentiment` and `/markets/{id}/comparables` as new sub-panels

**Week 3-4**
- [ ] Replace Top-Holders panel data source with `/markets/{id}/holders` (adds behavior tags)
- [ ] Wire `/ask` into the existing Q&A input
- [ ] Switch high-load market-detail page to a single `/research` call

**Week 5+**
- [ ] Add counter-thesis toggle to the Research panel (just pass `counter=true`)
- [ ] Cache tuning per panel

---

## v1.0-rc1 implementation notes — read before codegen

The OpenAPI spec is the **target contract** at v1.0. The current implementation (v1.0-rc1) ships with two known shape divergences that will be aligned before v1.0:

1. **`/ask` returns `claims[]` + `citations[]`** (current) rather than `answer: string` + `citations[]` (spec). Each claim is `{ text: string, citations: string[] }` so concatenating `.map(c => c.text).join(' ')` gives you a flat answer string for now.
2. **`/markets/{id}/thesis` returns** `{ verdict: 'yes'|'no'|'none', confidence: 'high'|'med'|'low', sections: { setup, book, smart, catalysts, verdict }, citations }` — structured as a Brief shape per pmcopilot's internal model rather than the flat `verdict / edge_pp / summary / bull_case / bear_case` of the spec.
3. **`/markets/{id}/sentiment` and `/comparables`** return `claims[] + citations[]` (SectionOut shape) rather than the structured envelope in the spec.

These are tracked in the v1.0 milestone and will be aligned in v1.0 final (Week 2). The codegen-from-spec approach is still recommended — Zayd's client just needs a small adapter layer for these three endpoints.

If you'd prefer the spec be updated to match the implementation as-is, ping me — happy to ship that as v1.0-rc2 today.

## Known limits in v1

1. **Polymarket only.** Limitless support ships in v1.1 (market IDs will be namespaced with a `lim:` prefix). Kalshi via partner agreement when their API is open.
2. **No webhooks in v1.** All polling. Webhook subscriptions for news / verdict-change events ship in v1.2.
3. **English-language news only.** Multilingual ingest is on the v1.3 roadmap.
4. **Resolution `realized_value` field is best-effort.** Tier-1 extractor (resolution-note text) ships in week 2; tier-2 (domain APIs for weather / price) is v1.2.

If any of these would block your integration, ping me — we can reshuffle the roadmap.

---

## Support

- **Slack / Discord:** we'll join your team channel
- **GitHub:** open issues against `github.com/Torque44/pm-copilot-oss` (or email if private)
- **Email:** ayushya2002@gmail.com
- **Response time:** within 4 hours during US-day hours, 12 hours otherwise

— AJ
