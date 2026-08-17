# AFL Tipping Backlog

Last updated: 2026-08-07

This is the canonical planning view for the project.

Supporting docs remain available for track-specific detail:
- [BACKLOG_FEATURES.md](BACKLOG_FEATURES.md)
- [BACKLOG_BUGS.md](BACKLOG_BUGS.md)
- [BACKLOG_UI_UX.md](BACKLOG_UI_UX.md)

## Open / Planned

| Priority | Initiative | Type | Why it fits this codebase | What it would provide | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | `BL-023` Server-render stats and merge/cache season stats payload | Initiative | `My Stats` still boots through client auth and two heavy season APIs. | Faster stats, less duplicate season recomputation, and a lighter logged-in experience. | `Idea` |
| 2 | `BL-024` Server-render first chat batch and lazy-load reactions, mention extras, and admin-only extras | Initiative | Chat is already rich, but it still does a lot of boot work after mount. | Faster chat open without changing message, mention, reaction, or moderation behavior. | `Idea` |
| 3 | `BL-025` Fetch leaderboard trends only when the trend UI is opened | Initiative | The leaderboard core is fast now, but trend hydration still adds post-paint work. | Less unnecessary work for users who only want the ladder table. | `Idea` |
| 4 | `BL-028` Personal weekly recap card | Feature | You already generate round recaps and have rich stats/results data. | A “your round in one minute” view: score, movement, best pick, worst miss, leaderboard movement. | `Idea` |
| 5 | `BL-029` Announcement scheduling and expiry | Feature | Announcements already exist, but they are manual publish/delete only. | Let admins schedule posts, auto-expire old ones, and pin by round or week. | `Idea` |
| 6 | `BL-030` Pick diary / season journey | Feature | Stats and round results already have most of the raw data. | A member’s round-by-round picks history, best calls, heartbreaks, missed points, and team tendencies. | `Idea` |
| 7 | `BL-031` Notification preferences center | Feature | You already have reminders, mentions, announcements, and recap delivery surfaces. | User-level control over reminder emails, announcement emails, recap emails, and mention notifications. | `Idea` |
| 8 | `BL-032` Public/archive “Hall of Fame” | Feature | You already track champions, recaps, and season data. | A cleaner offseason experience: past winners, final ladders, recap archive, and season summaries. | `Idea` |
| 9 | `BL-033` Payment and onboarding workflow | Initiative | You already manage payment status and next-season interest. | Cleaner conversion from waitlist to invite to paid to active member. Simplified draft: [docs/BL-033-simplified-next-season-invite-flow.md](/Users/beauwilliams/Desktop/afl-tipping/docs/BL-033-simplified-next-season-invite-flow.md). Legacy spec: [docs/BL-033-payment-and-onboarding-workflow.md](/Users/beauwilliams/Desktop/afl-tipping/docs/BL-033-payment-and-onboarding-workflow.md) | `Idea` |
| 10 | `BL-034` Chat structure improvements | Feature | Chat is already rich with mentions, reactions, quoting, and admin context. | Pinned messages, round-specific threads or channels, a “mentions only” view, and round-day moderation tools. | `Idea` |
| 11 | `BL-035` Invocation/cost monitoring and route split | Initiative | `BL-022` improved feel but may increase dynamic render cost. | Better visibility into invocations and an escape hatch to split public static routes from authenticated dynamic shell if needed. | `Idea` |
| 12 | `BL-036` Production schema baseline and disaster recovery hardening | Initiative | The repo is not yet a full source of truth for the live Supabase schema, RLS, and recovery workflow. | Versioned schema baseline, backup/recovery runbook, and lower risk of losing site config or data fidelity. | `Deferred` |
| 13 | `UI-001` Add season switcher and remove hardcoded `2026` in nav/routes | UI | Current season is still hardcoded in user-facing navigation and routes. | Prevents yearly friction and confusion. | `Deferred` |
| 14 | `BL-011` Season archive selector and year-over-year comparison page | Feature | You already preserve season-scoped results, leaderboard, champions, and recaps. | Keeps the site useful across seasons. | `Deferred` |
| 15 | `BL-017` Optional SMS tipping reminders | Feature | Email reminders already exist and can be extended selectively. | Another reminder channel for members who ignore email. | `Deferred` |
| 16 | `BL-013` True multi-competition support | Initiative | The app is deep enough now that hosting multiple comps is plausible, but the data model still assumes one main comp. | Unlocks multiple separate tipping groups. | `Deferred` |

## Shipped / Complete

| Priority | Initiative | Type | Why it fits this codebase | What it would provide | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | `BL-021` Server-render round page initial payload and keep tip save client-side | Initiative | The round page is the core user surface and used to boot slowly in the browser. | Faster tipping page without changing tip-save or odds rules. | `Done` |
| 2 | `BL-022` Move layout auth/admin state server-side and trim global unread polling | Initiative | Every logged-in page was paying client shell work before feeling ready. | Faster shell readiness and less wasteful background polling. | `Done` |
| 3 | `BL-026` Admin anomaly inbox | Initiative | Automation health and audit logs existed, but nothing turned them into action items. | A “needs attention” queue for failed runs, due snapshots, stale results, recap due, and paid-lock issues. | `Done` |
| 4 | `BL-027` Private group leaderboard UX | Feature | Group APIs already existed and were ready to become a stronger retention feature. | Better mini-leagues with clearer standings, group identity, invite flow, and bragging rights. | `Done` |
| 5 | `BL-018` Server-render leaderboard first, then lazy-load trends and private groups | Initiative | Leaderboard was a high-traffic page with unnecessary initial delay. | Faster first paint on the ladder page. | `Done` |
| 6 | `BL-019` Server-render results pages instead of loading after mount | Initiative | Results pages were loading blank and filling in later. | Faster results browsing without changing scoring behavior. | `Done` |
| 7 | `BL-020` Defer non-essential chat boot data | Initiative | Chat had secondary data blocking first use. | Faster chat open by delaying non-essential boot work. | `Done` |
| 8 | `BL-014` Automated regression tests for scoring logic and lock-time behavior | Initiative | The comp rules are high-risk and benefit from stable coverage. | Better protection against subtle scoring or lock regressions. | `Done` |
| 9 | `BL-015` Audit log for admin actions | Initiative | Manual admin actions needed traceability once the comp got more operational tooling. | Clear history of who changed what and when. | `Done` |
| 10 | `BL-016` Observability for failed jobs | Initiative | Background jobs were important enough to need active visibility. | Faster incident response during rounds. | `Done` |
| 11 | `UI-003` Shared UI tokens/components | UI | The app had enough repeated surfaces to benefit from design consistency. | Faster UI iteration and a cleaner shared visual language. | `Done` |
| 12 | `UI-005` Skeleton loading states | UI | The app had real loading time that benefited from better perceived performance. | Smoother loading states on round, results, and leaderboard surfaces. | `Done` |
| 13 | `UI-006` Admin IA cleanup into sections | UI | Admin tools had become powerful but cluttered. | A calmer, lower-risk admin centre. | `Done` |
| 14 | `UI-007` Standardized toast/status feedback | UI | Action feedback was inconsistent across the app. | Clearer save/sync/reminder outcomes with less confusion. | `Done` |
| 15 | `BUG-005` Automated checks for leaderboard sort and tip-list grouping | Initiative | Those presentation rules were important enough to protect with tests. | Prevents quiet regressions in leaderboard and round status views. | `Done` |
