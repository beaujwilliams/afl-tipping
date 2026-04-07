# UI/UX Backlog

Last updated: 2026-04-07

## Planned UI/UX Work

| ID | Priority | Status | UI/UX Item | Why it helps | Effort | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| UI-001 | P0 | Deferred | Add season switcher and remove hardcoded `2026` in nav/routes | Prevents yearly friction and confusion | S | Post-season only; mapped from `BL-003` |
| UI-003 | P1 | Done | Shared UI tokens/components for cards, buttons, badges, table headers | Consistency and faster iteration | M | Completed rollout across dashboard, round, leaderboard, and results surfaces |
| UI-005 | P1 | Done | Skeleton loading states for round/leaderboard/results | Better perceived performance | S | Replaced plain loading copy with shared skeleton states on leaderboard, round detail, and results pages |
| UI-006 | P1 | Done | Admin IA cleanup into sections (Data Sync, Comms, Members, Scoring) | Reduces misclick risk and speeds admin tasks | S | Shipped on 2026-04-07. Reworked the admin home into an automation-first control centre, pushed manual sync tools into low-emphasis maintenance, surfaced logs earlier, and collapsed raw responses by default |
| UI-007 | P2 | Done | Standardized toast/status feedback for saves, syncs, reminders | Clearer action outcomes and less uncertainty | S | Shipped on 2026-04-07. Added a shared toast provider and replaced key action feedback on profile, admin, reminders, chat deletes, public interest signup, and round tip save flows |
