# Phase 1 baseline — pre-rewrite test results

Captured against current `main` (commit before the cf-azure-rewrite branch
diverged) by running `pnpm test --run` on Node 20 with no Azure / CF in
the picture. Every test in this list MUST still pass after Phase 2 + 3
land — see Phase 4 of the plan in `~/.claude/plans/`.

## Result summary

```
Test Files  6 passed (6)
     Tests  99 passed (99)
```

## Test files + counts

| File | Tests | Covers |
|---|---|---|
| `packages/core/src/sources/registry.test.ts` | 38 | `isDenylisted` (Wikipedia + Wikimedia + Reddit + Medium + Substack hard-banned, mainstream news allowed, www-prefix stripping, malformed input). `isAllowlisted` (per-subcategory domain allowlists, subdomain matching). `isAllowlistedHandle` (vetted X handles, @-stripping, case-insensitive lookup). |
| `apps/server/src/cache.test.ts` | 7 | TTL hit / miss / re-run after expiry. Singleflight coalescing concurrent loaders for same key. Different keys don't coalesce. `invalidate(key)` and `clear()` semantics. |
| `apps/server/src/persist.test.ts` | 6 | **CRITICAL FOR AZURE FILES VOLUME.** Snapshot write to `${CACHE_DIR}/snapshot.json`. Round-trip across simulated process restart. `loadSnapshot` returns null on cold boot, on version mismatch, on malformed JSON. Multiple producers merge into one snapshot. |
| `packages/core/src/agents/ask.test.ts` | 10 | `salvageSectionedClaims` regex parser: single + multiple sections, citation extraction with registry filtering, middle-dot vs hyphen citation id canonicalisation, ```json``` fence stripping, empty input, label normalisation, 600-char body cap, parens in section labels. |
| `apps/web/src/lib/routing.test.ts` | 24 | `routeToPath` for every Route variant (home, setup, settings, market, event) with special-character encoding. `pathToRoute` parsing, query string + fragment + trailing slash stripping, fall-through to home on garbage. Lossless round-trip for every Route variant including unicode marketIds. |
| `apps/web/src/hooks/useAuth.test.ts` | 14 | `isPlausibleEvmAddress` (0x + 40 hex). `signedIn` requires BOTH wallet AND `onboardingComplete` (locks in the Twitter-screen-skipped bug fix from commit `316ab56`). `setWallet` validation. `setXHandle` @-stripping. `signOut` wipes all localStorage keys. Hydration from existing localStorage on mount. |

## Tests deferred (not in this baseline — would need heavier mocking)

The original plan listed 15 test files. The 6 above are the load-bearing
ones for the cf-azure rewrite. The remaining surfaces require either LLM
provider mocks or DOM testing infrastructure beyond what's worth setting
up for this baseline:

- `synthesis.test.ts` — citation allowlist enforcement. Needs a stub LLM
  provider that returns canned JSON. Defer to a follow-up that exercises
  the full `synthesizeBrief` pipeline against the stub provider.
- `comparables.test.ts` — base-rate floor (n ≥ 3). Needs Polymarket
  Gamma API mock + LLM provider mock. The floor logic is internal to
  `runComparables`; we'd extract it into a pure helper to make this
  testable.
- `sentiment.test.ts` — handle allowlist + xAI live-search-disabled
  warning. Needs LLM provider mock + control over the `warnings` field.
- `anthropic.provider.test.ts` — subprocess path spawns `claude -p`.
  Needs the `claude` CLI installed on the test runner. Defer to the
  Phase 4 smoke run inside the Azure Container.
- `client.test.ts` (apps/web) — `VITE_API_BASE` prefix + BYOK headers.
  Needs `fake-indexeddb` for the cryptoStorage layer. Will land
  alongside the Phase 3 rewrite of `client.ts` — easier to test the
  new code than the old.
- `useAsk.test.ts` — localStorage hydration + the wipe-on-reload race
  fix. Heavy SSE-stream mocking for current code; trivial after Phase 3
  rewrites the hook to plain fetch. Defer until Phase 3.
- `useSSE.test.ts` — getting deleted in Phase 3 anyway.
- `LandingFlow.test.tsx` — ticker dedupe + outcome leader. Needs
  `fetch` mock + `vi.useFakeTimers` for the ticker animation. Defer.
- `routes/resolve.test.ts` — Polymarket URL parsing. Worth adding;
  defer to a follow-up since it's a server-side route that doesn't
  change shape across the rewrite.

## Re-run after Phase 4

After the rewrite lands, run `pnpm test --run` again. Expected outcome:
all 99 tests still pass. Any new failure is a regression in the rewrite
and must be fixed before merging `cf-azure-rewrite → main`.
