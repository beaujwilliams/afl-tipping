# Feature Backlog

Last updated: 2026-04-07

## Prioritized Features

| ID | Priority | Status | Feature | Why it helps | Effort | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BL-011 | P1 | Deferred | Season archive selector and year-over-year comparison page | Keeps site useful across seasons | M | Post-season only |
| BL-014 | P2 | Done | Automated regression tests for scoring logic and lock-time behavior | Prevents subtle scoring errors | M | Shipped on 2026-04-07. Regression suite now covers scoring math, lock boundaries, snapshot timing, post-lock visibility, and round-results ordering/math with 30 passing tests |
| BL-015 | P2 | Done | Add audit log for admin actions (sync, snapshot, recalc, member changes) | Better traceability when results look wrong | M | Shipped on 2026-04-07. Added admin audit storage, a read-only audit log page/API, and manual admin action logging for member changes, payment settings, season winners, fixture sync, result sync, leaderboard recalc, and due-round snapshot checks |
| BL-016 | P2 | Done | Add observability: structured logs + alerting when sync/snapshot jobs fail | Faster incident response during rounds | M | Shipped on 2026-04-07. Added automation job run logging for due-round odds snapshots and pre-lock reminders, a combined automation health API/page, and an admin dashboard alert surface for recent failures |
| BL-018 | P1 | Done | Server-render leaderboard first, then lazy-load trends and private groups | Biggest real load-time improvement on the slowest high-traffic page | L | Shipped on 2026-04-07. Initial leaderboard now renders on the server; trends and private groups hydrate after first paint without changing ranking logic |
| BL-019 | P1 | Done | Server-render results pages instead of loading after mount | Removes blank/loading phase on results index and round detail pages | L | Shipped on 2026-04-07. Results index is now server-rendered and round detail hydrates from a shared server payload; recap/admin extras still load client-side |
| BL-020 | P2 | Done | Defer non-essential chat boot data | Faster chat open by loading mention directory and secondary data after first paint | M | Shipped on 2026-04-07. Chat no longer waits on the full mention directory before becoming ready; the core message list loads first, with mention directory hydration deferred to idle time or first composer interaction |
| BL-017 | P3 | Deferred | Optional SMS tipping reminders (opt-in only) | Better last-minute reminder reach for users who ignore email | M | Target implementation window: Feb 2027. Keep email as default; focus on low-cost provider and strict consent/opt-out handling. |
| BL-013 | P2 | Deferred | Migrate from single-competition assumptions to true multi-comp support | Unlocks hosting multiple tipping groups | XL | Post-season only; larger platform change |
| BL-003 | P2 | Moved to UI backlog | Stop hardcoding `2026` in nav/routes and auto-resolve current season | Avoids yearly breakage and manual code edits | S | Now tracked as `UI-001` |
