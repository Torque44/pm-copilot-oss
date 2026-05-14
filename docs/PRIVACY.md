# Privacy policy — pm-copilot

Last updated: 2026-05-11

This is a v1 read-only research tool. It's run by a single operator
(@0xayushya / Torque44) for product-research and portfolio purposes.
This document is the truth about what we collect, why, and how to make
us delete it.

## What we collect server-side

When you visit the hosted deploy at `https://pmcopilot.wtf`, we store
the following on our server (Azure Container Apps with a persistent
volume):

| Field | Source | Why |
|---|---|---|
| Wallet address (`0x…`) | What you paste into the onboarding screen | Counts unique users; lets us tell investors "X people use this" |
| X / Twitter handle | What you paste into the onboarding screen (optional) | Same |
| Visit timestamps | When you load the site | DAU / WAU / retention metrics |
| Brief requests | Each time you research a market | "Top researched markets" stat |
| Ask requests | Each time you ask a follow-up question | Volume only — see below |
| Market views | Each time you click a market in the rail | Engagement metrics |
| The category of the market (politics / sports / crypto / etc.) | Derived from the marketId | Topic-popularity breakdown |

That's it. Specifically:

- We DO NOT store your IP address.
- We DO NOT store the text of any question you ask the chat / Ask agent.
  We only store *that* an ask happened, for which market, and the length
  of the question.
- We DO NOT store the response any agent gave you.
- We DO NOT store your provider API keys. Those live encrypted in your
  browser's IndexedDB (AES-GCM) and travel only as per-request
  `x-llm-key` headers, never persisted server-side.
- We DO NOT share, sell, or otherwise hand this data to any third party,
  including for LLM training or analytics SaaS.

## Where it lives

- File: `/var/data/analytics/` on an Azure Files share attached to one
  Container App instance.
- Format: `users.json` (one record per wallet) and `events.ndjson`
  (one line per event). Both are plain JSON / NDJSON.
- Backups: none (it's persistent-disk only).

## How long we keep it

- Identity records (wallet, handle): kept as long as the operator runs
  this project. No automatic deletion.
- Event log: kept rolling. We may compact older events into aggregate
  rows if the file gets large.

## Who can read it

Only the operator (@0xayushya / Torque44), via an admin endpoint that
requires a shared-secret token (`ADMIN_TOKEN` env var on the Container
App). There is no other access path.

The data is not exposed publicly. Only aggregate, *de-identified*
numbers (e.g. "N unique users", "top researched topic = elections")
appear in portfolio / job-application materials.

## Polymarket exposure

To show you your own positions, we forward your wallet address to
Polymarket's public data API (`data-api.polymarket.com`). Polymarket
sees the wallet on every position-lookup request. This is unavoidable
for the feature to work; if you don't want Polymarket to receive your
wallet, don't paste it into the onboarding screen — the rest of the
site still works anonymously.

## How to delete your data

Email `tanisha9704@gmail.com` with the wallet address you pasted and
the subject "pm-copilot data delete". We'll remove your user record
and all events tied to that wallet within 7 days. We don't require
proof — if you know the wallet, that's enough.

(A self-serve "delete my data" button is on the roadmap.)

## Legal basis (EU / UK readers)

Lawful basis: legitimate interest (product analytics for an
open-source research tool). You can object at any time via the email
above and we will delete. There is no automated decision-making.

## Contact

Email: `tanisha9704@gmail.com`
GitHub: <https://github.com/Torque44/pm-copilot-oss>

If anything here is unclear, please open an issue on GitHub — that's
the canonical place to ask privacy questions about this deploy.
