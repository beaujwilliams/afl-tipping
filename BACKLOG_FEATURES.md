# Feature Backlog

Last updated: 2026-04-07

## Prioritized Features

| ID | Priority | Status | Feature | Why it helps | Effort | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BL-011 | P1 | Deferred | Season archive selector and year-over-year comparison page | Keeps site useful across seasons | M | Post-season only |
| BL-014 | P2 | Doing | Automated regression tests for scoring logic and lock-time behavior | Prevents subtle scoring errors | M | Baseline suite + CI scheduling in progress |
| BL-015 | P2 | Idea | Add audit log for admin actions (sync, snapshot, recalc, member changes) | Better traceability when results look wrong | M | Ops visibility |
| BL-016 | P2 | Idea | Add observability: structured logs + alerting when sync/snapshot jobs fail | Faster incident response during rounds | M | Ops reliability |
| BL-018 | P1 | Done | Server-render leaderboard first, then lazy-load trends and private groups | Biggest real load-time improvement on the slowest high-traffic page | L | Shipped on 2026-04-07. Initial leaderboard now renders on the server; trends and private groups hydrate after first paint without changing ranking logic |
| BL-019 | P1 | Done | Server-render results pages instead of loading after mount | Removes blank/loading phase on results index and round detail pages | L | Shipped on 2026-04-07. Results index is now server-rendered and round detail hydrates from a shared server payload; recap/admin extras still load client-side |
| BL-020 | P2 | Idea | Defer non-essential chat boot data | Faster chat open by loading mention directory and secondary data after first paint | M | No chat or tipping rule changes; keep core message list first, extras later |
| BL-017 | P3 | Deferred | Optional SMS tipping reminders (opt-in only) | Better last-minute reminder reach for users who ignore email | M | Target implementation window: Feb 2027. Keep email as default; focus on low-cost provider and strict consent/opt-out handling. |
| BL-013 | P2 | Deferred | Migrate from single-competition assumptions to true multi-comp support | Unlocks hosting multiple tipping groups | XL | Post-season only; larger platform change |
| BL-003 | P2 | Moved to UI backlog | Stop hardcoding `2026` in nav/routes and auto-resolve current season | Avoids yearly breakage and manual code edits | S | Now tracked as `UI-001` |
