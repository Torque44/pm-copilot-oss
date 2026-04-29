# pm-copilot ui kit

interactive recreation of the **research desk** — the headline screen described in the brief.

## what's here

- `index.html` — full research desk, with a state switcher in the top-right corner. switches between the priority-ordered states described in the brief.
- `LeftRail.jsx` — sticky search + category tabs + scrollable event list with nested outcome rows
- `RightRail.jsx` — watchlist + recently-viewed + 7-dot agent status row (one dot per specialist: market / holders / news / thesis / calibrator / risk / reporter)
- `MarketHeader.jsx` — sticky title + YES/NO prices + days-to-resolution + 24h volume + venue chip + click-to-expand resolution criteria
- `EvidenceGrid.jsx` — 2x2 panels: book / holders / news / thesis. each panel a focusable workbench unit.
- `VerdictBand.jsx` — descriptive-only verdict text + implied-yield + key-metrics row
- `Chat.jsx` — sticky one-line collapsed bar at the bottom of the workbench; expands on focus
- `CommandPalette.jsx` — ⌘K palette
- `States.jsx` — wrappers for the priority states (empty, loading, error, compare, settings, mobile)
- `agents.js` — agent specialist labels + state machine

## states demonstrated (priority order)

1. **research desk — binary outcome** — `BTC at $100K by EOY 2026` on polymarket
2. **research desk — multi-outcome** — `2028 dem nominee` (35-way race; first 5 + "+30 more" expander)
3. **empty state** — no market selected; recently-viewed grid
4. **loading state** — agent dots animating, panel skeletons, sticky toast
5. **error state** — inline panel error w/ retry + switch provider
6. **citation flash** — pill click → cyan glow on source row + scroll into view
7. **compare mode** — workbench split 50/50 with two markets side-by-side
8. **settings modal** — provider switch + MCP server registry + theme toggle
9. **mobile fallback** — single-column scrolling brief

## keyboard shortcuts surfaced in the design

- **⌘K** command palette
- **⌘1-4** focus an evidence panel
- **⌘[ · ⌘]** toggle left / right rails
- **⌘D** compare mode
- **⌘P** pin chat answer to verdict band

## caveats

panel content (orderbook rows, holder concentrations, news headlines, thesis tree, verdict copy) is **illustrative**, not real data — written in the system's voice but not from a live source. once a real PM Copilot codebase exists, this kit should be regenerated against the actual component tree.
