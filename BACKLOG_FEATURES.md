# Feature Backlog

Last updated: 2026-03-11

## Prioritized Features

| ID | Priority | Status | Feature | Why it helps | Effort | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BL-011 | P1 | Idea | Season archive selector and year-over-year comparison page | Keeps site useful across seasons | M | Next candidate |
| BL-014 | P2 | Idea | Automated regression tests for scoring logic and lock-time behavior | Prevents subtle scoring errors | M | Should be pulled earlier due scoring sensitivity |
| BL-015 | P2 | Idea | Add audit log for admin actions (sync, snapshot, recalc, member changes) | Better traceability when results look wrong | M | Ops visibility |
| BL-016 | P2 | Idea | Add observability: structured logs + alerting when sync/snapshot jobs fail | Faster incident response during rounds | M | Ops reliability |
| BL-013 | P2 | Idea | Migrate from single-competition assumptions to true multi-comp support | Unlocks hosting multiple tipping groups | XL | Larger platform change |
| BL-012 | P1 | Deferred (not doing) | Public read-only leaderboard/results links (no auth) | Easier sharing with friends/family | M | Explicitly parked |
| BL-017 | P3 | Deferred (not doing) | Head-to-head mini-leagues inside the main comp | Adds game depth for power users | L | Explicitly parked |
| BL-018 | P3 | Deferred (not doing) | Optional power pick / double points mechanic for one game per round | Creates strategy and differentiation | M | Explicitly parked |
| BL-003 | P2 | Moved to UI backlog | Stop hardcoding `2026` in nav/routes and auto-resolve current season | Avoids yearly breakage and manual code edits | S | Now tracked as `UI-001` |

## Completed Feature Milestones

| ID | Priority | Status | Feature | Why it helped | Effort |
| --- | --- | --- | --- | --- | --- |
| BL-001 | P0 | Done (2026-03-07) | Remove hardcoded cron secret usage in admin UI and rely on secure server env + bearer auth only | Reduced security risk and accidental secret leakage | S |
| BL-002 | P0 | Done (2026-03-07) | Replace email-based admin checks with role-based authorization from memberships | More maintainable and supports multiple admins | M |
| BL-020 | P0 | Done (2026-03-07) | Add forgot/reset password flow | Prevents account lockouts and reduces admin support burden | S |
| BL-004 | P0 | Done (2026-03-07) | Add player self-service profile page | Removes admin bottleneck and improves identity in chat/leaderboard | S |
| BL-005 | P0 | Done (2026-03-07) | Add payment tracking in admin (`paid`, `pending`, `waived`) and optional lockout for unpaid users | Aligns entry-fee rules with app behavior | M |
| BL-006 | P1 | Done (2026-03-07) | Pre-lock reminders (T-3h) for members who have not tipped | Improves tip completion and engagement | M |
| BL-007 | P2 | Done (2026-03-09) | One-click admin reminders from round screen for users still missing tips | Faster operations on lock day | S |
| BL-010 | P1 | Done (2026-03-09) | Add tie-breaker policy + UI for final ladder ties | Prevents disputes at season end | S |
| BL-019 | P1 | Done (2026-03-09) | Add username capture during sign-up (validation + uniqueness) | Ensures clean display names from day one | S |
| BL-008 | P1 | Done (2026-03-11) | Personal stats page per user (best round, upset wins, streak history, missed rounds) | Added in-profile season stats and self-serve profile management | M |
| BL-009 | P1 | Done (2026-03-11) | Weekly recap module (biggest upset, most popular pick, perfect round) | Automated recap generation + admin recap history + narrative/raw stats review | M |
