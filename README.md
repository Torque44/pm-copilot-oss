# pm-copilot

> Open-source grounded research desk for prediction-market traders.
> Multi-venue, multi-LLM, MCP-pluggable. Drops in as a Claude Code skill.

**Status:** v0.1.0-beta · private beta · not yet open to the public

---

## What it is

A workbench where a prediction-market trader picks a contract on Polymarket (Kalshi soon), and four-to-seven specialist agents fan out in parallel to surface the orderbook, top holders, dated catalysts, X sentiment from PM-active KOLs, and a thesis tree — every claim citation-grounded to a clickable source row.

Replaces the hallucinating "AI research" surface in existing PM terminals (the kind that returns the shareholders of YES Network the TV channel when you ask about a BTC contract). The fix is at the architecture layer: parallel-fetch BEFORE the LLM, citation-ID allowlist AFTER, clickable grounding rail in the UI.

Read-only by design. We don't place orders.

## Beta usage (hosted)

Beta users hit the hosted instance at `pm-copilot.{your-domain}` after invite.
First load → setup screen → paste an Anthropic API key (or have Claude Code
installed locally for zero-touch auth) → click a market → grounded brief
streams in.

Provider keys never leave your browser. They're encrypted to IndexedDB and
sent only as a per-request header to the LLM provider, never logged or
persisted server-side.

## Self-host (local)

```bash
git clone {this repo}
cd pm-copilot
pnpm install
cp .env.example .env
# Edit .env: pick PROVIDER + paste matching key. If using Claude Code locally,
# leave ANTHROPIC_API_KEY blank.
pnpm dev
```

Frontend at `http://localhost:5173`. Backend at `http://localhost:8787`.

## Architecture (1-paragraph)

Vite + React 19 frontend → Express backend → SSE per brief request → supervisor
fans out 3-7 specialist agents in parallel against Polymarket Gamma+CLOB+Data
APIs (and X via xactions MCP if xAI configured) → synthesis agent merges with
citation-ID allowlist → SSE streams sections back. All LLM calls go through
the provider factory in `packages/core/providers/`. Cache + event bus persist
to disk snapshot. MCP plug-in registry lets users register their own data
feeds. Provider abstraction supports Anthropic / OpenAI / Gemini / Perplexity
/ xAI.

## Repo layout

```
pm-copilot/
├── apps/
│   ├── web/        # React frontend (Vite)
│   └── server/     # Express backend
├── packages/
│   ├── core/       # Agent kernel + providers + MCP registry + Polymarket feed
│   └── skill/      # Claude Code skill bundle
├── design-bundle/  # Snapshot from claude-design (UI source of truth)
├── docs/           # Architecture, API ref, voice guide
└── scripts/        # Pre-warm cache, smoke tests, demo recorder
```

## License

MIT. See [LICENSE](./LICENSE).
