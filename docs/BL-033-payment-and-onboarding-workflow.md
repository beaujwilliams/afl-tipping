# BL-033 Payment and Onboarding Workflow

Last updated: 2026-04-09

## Goal

Create a clear admin workflow that moves a person from:

1. next-season interest
2. review/contact
3. invite/join
4. payment pending
5. active member

without changing any tipping, scoring, lock-time, or odds behavior.

## Why this exists

The repo already has the core pieces:

- public next-season interest capture
- admin review for interested people
- member admin and payment status
- unpaid tip lock
- email tooling for season-open outreach

The missing piece is a single joined-up operational workflow. Today the system can do each part, but it does not make the full onboarding funnel easy to run.

## Current system

### Existing public flow

- [app/next-season/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/next-season/page.tsx)
- [components/NextSeasonInterestForm.tsx](/Users/beauwilliams/Desktop/afl-tipping/components/NextSeasonInterestForm.tsx)
- [app/api/next-season-interest/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/next-season-interest/route.ts)

Current behavior:

- when signups are closed, people can submit name + email for `NEXT_SEASON`
- entries are upserted into `next_season_interest`
- public submissions are stored with `status = pending`

### Existing admin flow

- [app/admin/interested-members/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/interested-members/page.tsx)
- [app/api/admin/next-season-interest/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/next-season-interest/route.ts)
- [app/api/admin/next-season-interest/send-season-open/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/next-season-interest/send-season-open/route.ts)
- [app/admin/members/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/members/page.tsx)
- [app/api/admin/payment-settings/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/payment-settings/route.ts)

Current behavior:

- interested people can be searched, edited, exported, emailed in bulk, or deleted
- members can be edited once they are already in the competition
- payment state exists only after a person is already a member

### Current gap

The system does not explicitly model the in-between stages:

- reviewed
- contacted
- invited
- joined
- waiting on payment
- active
- archived

That means the admin workflow is still partly manual and memory-driven.

## V1 outcome

V1 should create a single onboarding pipeline that answers:

- who needs review?
- who has been invited but not joined?
- who joined but has not paid?
- who is fully active?

## Non-goals

BL-033 must not change:

- tip saving
- lock-time rules
- scoring logic
- odds capture or odds scoring
- unpaid tip lock behavior itself
- signup/auth routing rules beyond linking people into the workflow

This is an admin and lifecycle workflow only.

## Proposed pipeline stages

V1 should introduce a new onboarding stage for next-season records.

Suggested stage values:

- `new`
  Fresh interest submission with no admin action yet.
- `reviewed`
  Admin has looked at the person and kept them in the pipeline.
- `contacted`
  Manual outreach or follow-up has happened.
- `invited`
  Season-open or join email has been sent, or the person has otherwise been invited to join.
- `joined`
  The person has created an account and is now a competition member.
- `payment_pending`
  The person is a member, but payment is still pending.
- `active`
  The person is a member and their payment state is `paid` or `waived`.
- `archived`
  Not proceeding, duplicate, or not relevant for the current season.

## Status mapping rules

V1 should avoid duplicating payment truth.

Rules:

- payment truth remains on `memberships.payment_status`
- onboarding stage should derive payment-related state when a person is linked to a member
- if a linked member has `payment_status = pending`, stage resolves to `payment_pending`
- if a linked member has `payment_status = paid` or `waived`, stage resolves to `active`

The onboarding table can store the last selected stage, but the UI should show the derived payment outcome when a linked member exists.

## Proposed data model

Extend `next_season_interest` instead of creating a completely separate table.

### New columns

- `pipeline_stage text not null default 'new'`
- `reviewed_at_utc timestamptz null`
- `contacted_at_utc timestamptz null`
- `invited_at_utc timestamptz null`
- `archived_at_utc timestamptz null`
- `archived_reason text null`
- `linked_user_id uuid null`
- `linked_membership_competition_id uuid null`
- `last_contact_note text null`

### Constraints

- `pipeline_stage` check constraint over the allowed values
- foreign key for `linked_user_id` only if the current schema safely supports it
- length limits on free-text note/reason fields

### Why extend instead of creating a new table

- keeps existing public interest submissions intact
- reduces migration and admin UI complexity
- lets the current interested-members list evolve into the pipeline instead of being replaced

## Admin UX v1

### Primary page

Add a new page:

- [app/admin/onboarding/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/onboarding/page.tsx)

This should become the main operational surface for pre-season onboarding.

### Page sections

1. Summary cards
- New
- Invited
- Joined
- Payment pending
- Active
- Archived

2. Pipeline tabs or filters
- All
- Needs review
- Ready to invite
- Invited, not joined
- Payment pending
- Active
- Archived

3. Per-row details
- full name
- email
- source
- submitted date
- current pipeline stage
- notes
- linked member display name if present
- linked payment status if present
- last action date

4. Per-row actions
- mark reviewed
- mark contacted
- send invite
- resend invite
- link to member
- unlink member
- archive

### Row behavior

Keep actions direct and operational.

Examples:

- `Mark reviewed`
  Moves `new` to `reviewed`
- `Mark contacted`
  Updates stage to `contacted` and stamps `contacted_at_utc`
- `Send invite`
  Calls the season-open email path for that one person and moves to `invited`
- `Link member`
  Connects the interest row to an actual joined user
- `Archive`
  Moves the record out of the active funnel without deleting history

## API shape v1

### New API

- [app/api/admin/onboarding/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/onboarding/route.ts)

Suggested responsibilities:

- list onboarding records with derived stage data
- patch onboarding stage and notes
- link or unlink a row to a user/member

### Optional single-row actions

- [app/api/admin/onboarding/[id]/invite/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/onboarding/[id]/invite/route.ts)
- [app/api/admin/onboarding/[id]/link-member/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/onboarding/[id]/link-member/route.ts)

These can also remain as action fields on the main route if we want to keep the API surface smaller.

## Relationship to existing pages

### Keep

- [app/admin/interested-members/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/interested-members/page.tsx)
  Keep as a simpler raw list/export page for now, or turn it into a thin view over the same dataset.

- [app/admin/members/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/members/page.tsx)
  Keep as the source of truth once someone is in the competition.

### Add

- onboarding page as the operational funnel

### Do not do in v1

- do not merge members admin and onboarding admin into one giant page
- do not replace the current payment settings UI

## Linking strategy

V1 needs a safe way to connect an interested person to a real joined user.

Suggested approach:

1. exact email match on normalized email can be suggested
2. admin confirms the link explicitly
3. once linked:
   - the onboarding row can show member name and payment status
   - stage can resolve to `payment_pending` or `active`

Do not auto-link silently.

## Email behavior

V1 should reuse the existing season-open email path rather than inventing a second invite system.

Reuse:

- [app/api/admin/next-season-interest/send-season-open/route.ts](/Users/beauwilliams/Desktop/afl-tipping/app/api/admin/next-season-interest/send-season-open/route.ts)

Possible v1 extension:

- support single-row send in addition to bulk send
- log invite send timestamp into onboarding fields

## Audit and observability

Every stage-changing admin action should be auditable.

Reuse:

- [app/admin/audit-log/page.tsx](/Users/beauwilliams/Desktop/afl-tipping/app/admin/audit-log/page.tsx)
- [lib/admin-audit.ts](/Users/beauwilliams/Desktop/afl-tipping/lib/admin-audit.ts)

Events to record:

- onboarding stage changed
- onboarding notes changed
- invite sent
- member link created or removed
- onboarding row archived

## Suggested rollout plan

### Phase 1

- migration for new onboarding fields on `next_season_interest`
- shared workflow helpers in `lib/`
- read-only onboarding list with derived stages

### Phase 2

- stage update actions
- member linking
- audit events

### Phase 3

- single-row invite send
- dashboard counts / anomaly integration if useful

## Suggested helper layer

Add a small shared rules module:

- [lib/onboarding-workflow.ts](/Users/beauwilliams/Desktop/afl-tipping/lib/onboarding-workflow.ts)

Responsibilities:

- normalize stage values
- derive display stage from stored stage + linked membership payment status
- produce summary counts
- enforce allowed transitions

## Allowed transitions

Keep transitions simple in v1.

- `new` -> `reviewed`
- `reviewed` -> `contacted`
- `contacted` -> `invited`
- `invited` -> `joined`
- `joined` -> `payment_pending`
- `payment_pending` -> `active`
- any non-active stage -> `archived`
- `archived` can be restored manually to `reviewed`

If a linked member payment status changes, the UI can derive `payment_pending` or `active` regardless of the stored stage.

## Reporting value

This workflow should make it easy to answer:

- how many people are still waiting on review?
- how many invites are sitting unconverted?
- how many joined but have not paid?
- who still needs action before season start?

## Recommended backlog follow-up

If BL-033 is selected for implementation, add these sub-tasks:

- `BL-033A` Add onboarding stage fields and helpers
- `BL-033B` Build admin onboarding pipeline page
- `BL-033C` Add member linking and derived payment stage
- `BL-033D` Add single-row invite send and audit coverage

## Recommendation

This is a good pre-season initiative and should be built close to the season-open period, not in the middle of round-critical work.

Priority recommendation:

- build before February 2027
- not urgent during active in-season operations
