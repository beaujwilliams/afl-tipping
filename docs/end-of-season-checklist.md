# End-of-Season Checklist

Last updated: 2026-08-07

This checklist turns the current season wrap-up and next-season prep into three buckets:

- August
- After Grand Final
- Before 2027 signup opens

Use it as the working operational checklist for the transition out of season 2026.

## August

### Core weekly operations

- [ ] Keep weekly result syncs, leaderboard recalcs, and round recap sends clean through the end of the home-and-away season.
- [ ] Check the admin anomaly inbox after each round and clear anything still needing action.
- [ ] Confirm automation health stays clean across scoring, reminders, and odds snapshot jobs.

Relevant surfaces:

- [app/admin/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/page.tsx)
- [app/admin/automation-health/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/automation-health/page.tsx)
- [app/api/admin/anomalies/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/anomalies/route.ts)

### Season-end admin hygiene

- [ ] Review current-season payments and resolve any outstanding member state issues that should not roll into offseason confusion.
- [ ] Sanity-check the season roster and confirm there are no admin cleanup tasks still sitting in limbo.
- [ ] Make sure the audit trail is in a good state before postseason changes begin.

Relevant surfaces:

- [app/admin/payments/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/payments/page.tsx)
- [app/admin/roster/[season]/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/roster/[season]/page.tsx)
- [app/admin/audit-log/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/audit-log/page.tsx)

### Feedback and next-season intake

- [ ] Finalize the end-of-season feedback form wording.
- [ ] Keep active-season signups closed and continue collecting next-season interest through `/next-season`.
- [ ] Decide whether the simplified next-season queue model is the direction to use for invites and onboarding.

Relevant docs and flows:

- [docs/end-of-season-feedback-form-draft.md](/Users/beauwilliams/Desktop/afl-tipping/docs/end-of-season-feedback-form-draft.md)
- [docs/BL-033-simplified-next-season-invite-flow.md](/Users/beauwilliams/Desktop/afl-tipping/docs/BL-033-simplified-next-season-invite-flow.md)
- [app/next-season/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/next-season/page.tsx)
- [app/admin/interested-members/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/interested-members/page.tsx)
- [app/admin/onboarding/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/onboarding/page.tsx)

## After Grand Final

### Close out the 2026 season

- [ ] Lock in the official season winner and champion records.
- [ ] Confirm reigning champion and champion-history data look correct in admin and public/member-facing contexts.
- [ ] Send the end-of-season feedback form while the season is still fresh.

Relevant surfaces:

- [app/api/admin/champion-settings/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/champion-settings/route.ts)
- [lib/reigning-champion.ts](/Users/beauwilliams/Desktop/afl-tipping/lib/reigning-champion.ts)
- [lib/season-champions.ts](/Users/beauwilliams/Desktop/afl-tipping/lib/season-champions.ts)

### Preserve season-end records

- [ ] Export or preserve the audit/history data you want before making offseason structural changes.
- [ ] Capture any final season summaries, recap references, or admin notes worth keeping.
- [ ] Make sure any post-season reporting you care about can still be reconstructed later.

Relevant surfaces:

- [app/audit/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/audit/page.tsx)
- [app/api/audit/export/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/audit/export/route.ts)
- [app/admin/recaps/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/recaps/page.tsx)

### Clean the next-season queue

- [ ] Review next-season interest submissions and onboarding rows.
- [ ] Dedupe, archive, or opt out the obvious cleanup cases.
- [ ] Confirm the queue is in a usable state before season-open invites begin.

Relevant surfaces:

- [app/admin/interested-members/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/interested-members/page.tsx)
- [app/admin/onboarding/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/onboarding/page.tsx)

### Post-season backlog items

- [ ] `BL-036`: production schema baseline and disaster recovery hardening.
- [ ] `BL-011`: season archive selector and year-over-year comparison.
- [ ] `BL-032`: public/archive Hall of Fame.
- [ ] `UI-001`: remove hardcoded `2026` season assumptions.

Relevant backlog references:

- [BACKLOG_FEATURES.md](/Users/beauwilliams/Desktop/afl-tipping/BACKLOG_FEATURES.md)
- [BACKLOG_UI_UX.md](/Users/beauwilliams/Desktop/afl-tipping/BACKLOG_UI_UX.md)

## Before 2027 Signup Opens

### Season rollover

- [ ] Update season configuration and env vars for the new season.
- [ ] Confirm signup-open and signup-closed behavior still read correctly across login and signup flows.
- [ ] Re-check all season labels and links before reopening invites and account creation.

Relevant references:

- [lib/season-config.ts](/Users/beauwilliams/Desktop/afl-tipping/lib/season-config.ts)
- [README.md](/Users/beauwilliams/Desktop/afl-tipping/README.md)
- [app/signup/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/signup/page.tsx)
- [app/login/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/login/page.tsx)
- [app/next-season/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/next-season/page.tsx)

### Hardcoded season cleanup

- [ ] Replace remaining hardcoded `2026` values on user-facing pages before the 2027 rollover.
- [ ] Prioritize the main pages already known to still hardcode the season.

Known pages to check:

- [app/stats/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/stats/page.tsx)
- [app/profile/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/profile/page.tsx)
- [app/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/page.tsx)
- [app/chat/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/chat/page.tsx)

### Invites and onboarding readiness

- [ ] Decide whether to ship the simplified onboarding/admin workflow before season-open invites.
- [ ] Test the invite, signup, onboarding, and payment path end to end.
- [ ] Confirm the next-season queue is ready before sending bulk season-open emails.
- [ ] Flip `NEXT_PUBLIC_SIGNUPS_OPEN=true` only after those checks are complete.

Relevant surfaces:

- [app/admin/interested-members/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/interested-members/page.tsx)
- [app/admin/onboarding/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/onboarding/page.tsx)
- [app/api/admin/next-season-interest/send-season-open/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/next-season-interest/send-season-open/route.ts)
- [app/api/admin/onboarding/[id]/invite/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/onboarding/[id]/invite/route.ts)

## Notes

- Keep active-season operational work ahead of nice-to-have product work until the 2026 season is fully wrapped.
- Treat the hardcoded-season cleanup as a real pre-launch task, not a cosmetic one, because it can create confusing rollover behavior.
- If BL-033 moves ahead, prefer the simplified queue model unless a stronger operational reason appears to keep the richer stage model.
