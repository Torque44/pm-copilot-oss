# 2026-05-12 Honest-Data Hardening — Manual Verification

After all Phase 1-3 tasks ship, run these on the deployed Azure URL to
confirm the user-visible behavior matches the spec.

## 1. Resolved-market briefing

Open: pmcopilot.wtf and paste the URL for any RESOLVED Polymarket event
(any market with `closed=true` on gamma). Example to start: search for
"Trump visit China June 30" or any market with "resolved" status.

Confirm:
- [ ] Slate-amber banner above the title row reads `resolved · {date} · final YES @ $1.00` (or NO)
- [ ] The "trade on polymarket ↗" pill is still present
- [ ] The watch button is NOT present
- [ ] Right-rail agent dots: market, holders, news, comparables, synthesis (5 dots, NO sentiment or thesis)
- [ ] catalysts tab shows news from the 30 days BEFORE the resolution date — not "right now"
- [ ] No "@Reuters" / "@CFR_org" / fabricated 2023 tweets ANYWHERE in the brief

## 2. Active market — happy path

Open: any active market (closed=false). Confirm:
- [ ] All 6 dots visible (market, holders, news, sentiment, thesis, synthesis) + comparables
- [ ] catalysts tab has at least 2 news items
- [ ] sentiment tab either has tweets OR clear "no recent X conversation surfaced" diagnostic — never fabricated handles/dates
- [ ] Each citation URL is real (right-click → open in new tab → verifies on the source domain)

## 3. Active market — backend degradation

(Only possible from staging with env-var control.)

On staging, unset `EXA_API_KEY`. Brief any active market. Confirm:
- [ ] catalysts tab shows the diagnostic claim "no live news backend configured — server needs EXA_API_KEY..."
- [ ] No silent empty
- [ ] Other panels (market, holders, sentiment) still work

Restore `EXA_API_KEY` after the test.

## 4. Cache behavior

Brief the same active market twice within 6h.

Confirm:
- [ ] Second request is noticeably faster on the catalysts panel (cache hit)
- [ ] News items between the two requests are identical
- [ ] Other panels (market, holders) re-fetch as before (book/holders aren't cached at this layer)

## 5. Sentiment URL provenance

For any politics or geopolitics market with active X conversation:
- [ ] Click each citation pill in the sentiment tab
- [ ] Confirm each URL opens a real X post (not a 404)
- [ ] Confirm the handle in the post matches the citation label

If even one citation is a 404 or a "Sorry, you can't view this Tweet" page,
the provenance check has a gap — file an issue.

## 6. Test suite

Run locally before any push:

```bash
pnpm typecheck   # workspace
pnpm test        # all 200+ tests
```

Expected: typecheck clean, all tests pass. Any regressions block the push.
