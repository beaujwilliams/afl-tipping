# Feature Backlog

Last updated: 2026-03-11

## Prioritized Features

| ID | Priority | Status | Feature | Why it helps | Effort | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BL-011 | P1 | Deferred | Season archive selector and year-over-year comparison page | Keeps site useful across seasons | M | Post-season only |
| BL-014 | P2 | Doing | Automated regression tests for scoring logic and lock-time behavior | Prevents subtle scoring errors | M | Baseline suite + CI scheduling in progress |
| BL-015 | P2 | Idea | Add audit log for admin actions (sync, snapshot, recalc, member changes) | Better traceability when results look wrong | M | Ops visibility |
| BL-016 | P2 | Idea | Add observability: structured logs + alerting when sync/snapshot jobs fail | Faster incident response during rounds | M | Ops reliability |
| BL-013 | P2 | Deferred | Migrate from single-competition assumptions to true multi-comp support | Unlocks hosting multiple tipping groups | XL | Post-season only; larger platform change |
| BL-003 | P2 | Moved to UI backlog | Stop hardcoding `2026` in nav/routes and auto-resolve current season | Avoids yearly breakage and manual code edits | S | Now tracked as `UI-001` |
