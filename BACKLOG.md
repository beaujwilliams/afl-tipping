# AFL Tipping Backlog

Last updated: 2026-03-07

## Effort Scale

- `XS`: 1-3 hours
- `S`: 0.5-1 day
- `M`: 2-4 days
- `L`: 1-2 weeks
- `XL`: 3+ weeks

## Prioritized Ideas

| ID | Priority | Status | Idea | Why it helps | Effort |
| --- | --- | --- | --- | --- | --- |
| BL-001 | P0 | Done (2026-03-07) | Remove hardcoded cron secret usage in admin UI and rely on secure server env + bearer auth only | Reduces security risk and accidental secret leakage | S |
| BL-002 | P0 | Done (2026-03-07) | Replace email-based admin checks with role-based authorization from `memberships` (owner/admin role) | More maintainable and supports multiple admins | M |
| BL-020 | P0 | Done (2026-03-07) | Add forgot/reset password flow (request reset email, secure recovery route, set new password UI) | Prevents account lockouts and reduces admin support burden | S |
| BL-004 | P0 | Done (2026-03-07) | Add player self-service profile page (display name, favorite team, read-only email, change-password link) | Removes admin bottleneck and improves user identity in chat/leaderboard | S |
| BL-005 | P0 | Idea | Add payment tracking in admin (`paid`, `pending`, `waived`) and optional lockout for unpaid users | Aligns entry-fee rules with app behavior | M |
| BL-006 | P1 | Doing | Pre-lock reminders (T-3h) for members who have not tipped | Improves tip completion and engagement | M |
| BL-007 | P1 | Idea | One-click admin reminders from round screen for users still missing tips | Faster operations on lock day | S |
| BL-008 | P1 | Idea | Personal stats page per user (best round, upset wins, streak history, missed rounds) | Increases retention and competitiveness | M |
| BL-009 | P1 | Idea | Weekly recap module (biggest upset, most popular pick, perfect round) | Shareable content and stronger community feel | M |
| BL-010 | P1 | Idea | Add tie-breaker policy + UI for final ladder ties | Prevents disputes at season end | S |
| BL-011 | P1 | Idea | Season archive selector and year-over-year comparison page | Keeps site useful across seasons | M |
| BL-012 | P1 | Idea | Public read-only leaderboard/results links (no auth) | Easier sharing with friends/family | M |
| BL-019 | P1 | Idea | Add username capture during sign-up (with validation + uniqueness rules) | Ensures clean display names from day one next season | S |
| BL-013 | P2 | Idea | Migrate from single-competition assumptions to true multi-comp support | Unlocks hosting multiple tipping groups | XL |
| BL-014 | P2 | Idea | Automated regression tests for scoring logic and lock-time behavior | Prevents subtle scoring errors | M |
| BL-015 | P2 | Idea | Add audit log for admin actions (sync, snapshot, recalc, member changes) | Better traceability when results look wrong | M |
| BL-016 | P2 | Idea | Add observability: structured logs + alerting when sync/snapshot jobs fail | Faster incident response during rounds | M |
| BL-003 | P2 | Deferred (end of 2026) | Stop hardcoding `2026` in nav/routes and auto-resolve current season from DB/config | Avoids yearly breakage and manual code edits | S |
| BL-017 | P3 | Idea | Head-to-head mini-leagues inside the main comp | Adds game depth for power users | L |
| BL-018 | P3 | Idea | Optional “power pick” / “double points” mechanic for one game per round | Creates strategy and differentiation | M |

## Suggested Next 5 to Build

1. `BL-005` payment tracking
2. `BL-006` pre-lock reminders
3. `BL-007` one-click admin reminders
4. `BL-019` username at sign-up
5. `BL-008` personal stats page

## Notes

- Keep this as the single backlog source of truth.
- When starting an item, change `Status` from `Idea` to `Doing`.
- Use `Deferred` for items explicitly parked for later.
- After release, set to `Done` and add a completion date in the row.
