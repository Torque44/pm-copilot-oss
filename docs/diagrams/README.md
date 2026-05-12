# pmcopilot.wtf — architecture diagrams

## Files

- [`pmcopilot-architecture.excalidraw`](./pmcopilot-architecture.excalidraw) —
  the canonical hand-drawn diagram. Open at [excalidraw.com](https://excalidraw.com)
  → Menu → Open → select this file. Edit, drop in real logo PNGs, export to
  PNG/SVG, embed in pitches.
- The Mermaid mirror below renders in GitHub so the diagram is readable
  without opening Excalidraw.

## How to add real brand logos to the .excalidraw

The file uses brand-coloured text for each provider/data source so it's
self-contained and human-readable. To swap text for actual logos:

1. Open the file at excalidraw.com.
2. Drag the logo PNG onto the canvas (recommend ~80×80 px for inline,
   ~120×120 for header logos).
3. Right-click the logo → "Send to back" so it sits behind the text label.
4. Drag the logo over the matching text (`Anthropic Claude` / `OpenAI ChatGPT`
   / etc.). Optionally delete the text once the logo is positioned.

Suggested logo sources (use the brand assets, not random downloads):

- Anthropic Claude — anthropic.com/brand
- OpenAI ChatGPT — openai.com/brand
- Google Gemini — about.google/brand-resource-center
- xAI Grok — x.ai (brand assets in footer)
- Perplexity — perplexity.ai/brand
- Polymarket — polymarket.com (favicon works for inline use)
- Exa AI — exa.ai (logo in nav)

---

## Mermaid mirror

```mermaid
flowchart TB
    user["1. YOU<br/>paste polymarket url or ask a question"]:::user
    supervisor["2. SUPERVISOR<br/>sanitize title · resolve venue · fan out wave 1"]:::supervisor

    user --> supervisor

    subgraph WAVE1 ["wave 1 — parallel fan-out"]
        direction LR
        market["(a) MARKET<br/>orderbook · imbalance ·<br/>liquidity depth · spread"]:::market
        holders["(b) HOLDERS<br/>top-5 wallets · concentration ·<br/>whale side-bias"]:::holders
        news["(c) NEWS<br/>self-healing chain<br/>3 backends × retry × 6h cache"]:::news
        sentiment["(d) SENTIMENT<br/>vetted X handles · 14d ·<br/>URL provenance"]:::sentiment
        comparables["(e) COMPARABLES<br/>no LLM · resolved markets ·<br/>Bayesian base rate"]:::comparables
    end

    supervisor --> market
    supervisor --> holders
    supervisor --> news
    supervisor --> sentiment
    supervisor --> comparables

    subgraph SOURCES ["data sources (real tools, not LLM knowledge)"]
        direction LR
        polyclob["🟣 POLYMARKET<br/>CLOB orderbook + Gamma meta"]:::source
        polydata["🟣 POLYMARKET<br/>Data API holders endpoint"]:::source
        newschain["1️⃣ EXA AI search-first<br/>2️⃣ POLYMARKET COMMENTS free<br/>3️⃣ PROVIDER WEB Perplexity/Claude"]:::source
        xai["🅧 xAI GROK<br/>Live X-Search on vetted handles"]:::source
        resolved["🟣 POLYMARKET<br/>Gamma resolved-market scan"]:::source
    end

    market -.-> polyclob
    holders -.-> polydata
    news -.-> newschain
    sentiment -.-> xai
    comparables -.-> resolved

    byok["PRIMARY LLM · your key, your bill · BYOK<br/><br/>Anthropic Claude · OpenAI ChatGPT · Google Gemini · xAI Grok · Perplexity Sonar<br/><br/>keys AES-GCM in IndexedDB · sent per-request as headers · never logged"]:::byok

    polyclob --> byok
    polydata --> byok
    newschain --> byok
    xai --> byok
    resolved --> byok

    thesis["(f) THESIS — wave 2<br/>supports vs challenges · direction score<br/>cites IDs only"]:::thesis
    synthesis["(g) SYNTHESIS — the brief writer<br/>can cite ONLY ids that exist in upstream evidence<br/>invented citations stripped server-side"]:::synthesis
    brief["3. GROUNDED BRIEF<br/>every claim is a clickable cite chip"]:::brief

    byok --> thesis
    thesis --> synthesis
    synthesis --> brief

    classDef user fill:#fef3c7,stroke:#1e1e1e,stroke-width:2px
    classDef supervisor fill:#dbeafe,stroke:#1e1e1e,stroke-width:2px
    classDef market fill:#c7d2fe,stroke:#1e1e1e,stroke-width:2px
    classDef holders fill:#ddd6fe,stroke:#1e1e1e,stroke-width:2px
    classDef news fill:#fef9c3,stroke:#1e1e1e,stroke-width:2px
    classDef sentiment fill:#d1fae5,stroke:#1e1e1e,stroke-width:2px
    classDef comparables fill:#e5e7eb,stroke:#1e1e1e,stroke-width:2px
    classDef source fill:#f9fafb,stroke:#525252,stroke-width:1px,stroke-dasharray:5 5
    classDef byok fill:#e0e7ff,stroke:#1e1e1e,stroke-width:2px
    classDef thesis fill:#fbcfe8,stroke:#1e1e1e,stroke-width:2px
    classDef synthesis fill:#fed7aa,stroke:#d97706,stroke-width:3px
    classDef brief fill:#bbf7d0,stroke:#1e1e1e,stroke-width:2px
```

---

## Invariants enforced in code (the "10x better" payload)

### 🚫 No fabrication

Every agent that surfaces evidence (URLs, tweets, articles) builds a
**citation registry from a real tool first**, then constrains the LLM to
*reference by index only*. The LLM never emits a primary key (URL, handle,
date) that wasn't already in the registry. Invented IDs in claim text are
stripped server-side before the brief reaches the client.

Sentiment specifically: tweet URLs are only accepted if they exist in
Grok's `citations[]` array from a real `liveSearch: on` call. Pass-2 of
the agent runs `liveSearch: off` against the pre-fetched evidence — the
model literally cannot mint a URL.

### 📰 Source denylist

Wikipedia, Reddit, Substack, Medium, Forbes contributor, Yahoo aggregator
are blocked at the agent boundary (3 layers: Exa pre-filter, news chain
post-filter, agent rendering). Curated allowlist per sub-category surfaces
only trader-grade outlets; off-list survivors get an "unverified" badge
the trader can discount.

### ♻️ Self-healing news chain

- **Exa AI** first (cheapest, search-first) with 3 attempts × 3 query
  variants × exponential backoff × 429 Retry-After handling.
- **Polymarket event comments** second (free, user-contributed quality
  flagged via `unverified` badge).
- **Provider web search** third (Perplexity Sonar or Claude with
  WebSearch tool — billable, used only when first two come up empty).
- **6h LRU cache** in front of all three: a transient backend failure is
  invisible to any user who saw real data on the same market within 6h.

When all 3 backends genuinely come up empty AND no cache hit, news emits
a diagnostic claim that distinguishes "no backend configured" from "ran
and got nothing" — never a silent empty.

### ✅ Resolved-market short-circuit

When Polymarket reports `closed: true`, the supervisor SKIPS the
sentiment and thesis agents entirely — both produce their worst
hallucinations when there's no real-time data to ground in. News still
runs but searches the 30-day window *before* resolution, not "right now".
A slate-amber banner above the market header signals the brief is a
post-mortem.

### 🔒 BYOK key handling

Provider keys never touch the server filesystem or logs:

- Stored in browser IndexedDB encrypted with AES-GCM (non-extractable
  key derived from a per-origin material). Cleared on sign-out.
- Sent per-request as `x-llm-key` / `x-perplexity-key` / `x-xai-key` /
  `x-anthropic-key` / `x-openai-key` / `x-google-key` headers.
- Server middleware reads, threads to the provider routing, then
  discards. No write to disk, no log line containing the header value,
  no inclusion in any cache key (cache keys use a per-process HMAC-SHA256
  digest of the key with a salt that rotates on every server restart).

### 📡 Abort-signal propagation

A client disconnect (browser tab close, navigation away, network drop)
aborts the in-flight chain: route handler → supervisor → agent ctx →
provider.complete fetch. Both brief and ask routes wire `req.on('close')`
into an `AbortController` that chains through every layer down to the
underlying `fetch`. No BYOK quota burned on answers no one is reading.
