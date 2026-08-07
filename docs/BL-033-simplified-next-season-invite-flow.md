# BL-033 Simplified Next-Season Invite Flow

Last updated: 2026-08-08

## Goal

Make next-season onboarding as simple as possible while still covering the minimum operational needs:

- know who might come back
- know who has been invited
- know who has joined
- know who still needs to pay
- know who should not be contacted

This should stay an admin and lifecycle workflow only. It should not change tipping, scoring, lock-time, or odds behavior.

## Core Recommendation

Treat next-season onboarding as one queue, not multiple separate processes.

Multiple sources should feed the same queue:

- prior participants from any season who have not opted out
- people who submitted the public next-season interest form
- people manually added by admin

From there, the admin workflow should have one main action:

- `Send invite`

Everything else should be inferred or derived where possible.

## Minimum Requirements

The minimum viable process only needs to do these things well:

1. collect people from all relevant sources
2. dedupe them by normalized email for the target season
3. suppress opted-out people
4. send a season-open invite
5. detect when someone has joined
6. detect whether they have paid
7. keep a small exception path for archive or manual cleanup

If a step does not directly help one of those outcomes, it should be optional rather than part of the default workflow.

## Recommended Status Model

Use the smallest status set that still reflects real lifecycle changes:

- `queued`
  Eligible for next-season outreach but not invited yet.
- `invited`
  Season-open invite sent.
- `joined`
  Account or membership created, but payment outcome not yet complete.
- `payment_pending`
  Joined, linked to a member, and still unpaid.
- `active`
  Joined and `paid` or `waived`.
- `archived`
  Do not actively pursue for this season.

Keep opt-out separate from the main status model:

- `opted_out_at_utc`
- `opt_out_reason`

That keeps "do not contact" from being mixed up with normal workflow progress.

## What To Remove From The Default Flow

These should not be required default stages:

- `reviewed`
- `contacted`

They can still exist as optional notes or audit events, but they should not be necessary to move someone forward.

The default process should not require an admin to remember whether a person was "reviewed" versus "contacted" before they can be invited.

## Recommended Data Model

Keep extending `next_season_interest` rather than building a second onboarding table.

Minimum fields:

- `target_season`
- `email`
- `email_normalized`
- `full_name`
- `status`
- `opted_out_at_utc`
- `opt_out_reason`
- `invited_at_utc`
- `archived_at_utc`
- `archived_reason`
- `linked_user_id`
- `linked_membership_competition_id`
- `source`
- `source_notes`
- `last_note`

Recommended source values:

- `prior_participant`
- `public_form`
- `admin_added`
- `end_of_season_form`
- `referral`

If the same person comes from multiple places, keep one row and preserve the strongest source context in notes or tags.

## Dedupe Rules

Use one row per `target_season + email_normalized`.

When a duplicate appears:

- keep the earliest row
- merge source context
- do not reset invite or join state backward
- do not re-activate opted-out rows without an explicit admin action

## Recommended Admin Screen

The admin experience should feel like a lightweight invite queue, not a CRM.

### Summary cards

- Queued
- Invited
- Joined
- Payment pending
- Active
- Archived

### Filters

- All
- Ready to invite
- Invited, not joined
- Payment pending
- Active
- Archived
- Opted out

### Row details

- full name
- email
- source
- invite status
- invited at
- linked member
- payment status
- last note

### Row actions

- `Send invite`
- `Resend invite`
- `Link member`
- `Archive`
- `Restore`
- `Mark opted out`

The row should have a clear primary action. For most queued rows, that should simply be `Send invite`.

## Recommended Workflow

1. Preload prior participants for the target season planning cycle, excluding opted-out people.
2. Continue accepting public "notify me next season" submissions into the same queue.
3. Allow admins to manually add people who have expressed interest elsewhere.
4. Dedupe by normalized email.
5. Send the season-open invite to everyone in `queued`.
6. When someone joins, link them to the member record and move them to `joined` automatically where possible.
7. Derive `payment_pending` and `active` from membership payment status.
8. Use `archived` and opt-out only for exceptions, cleanup, or explicit no-contact cases.

## Optional Workflow Additions

These are good additions, but they should stay optional so the base workflow remains simple:

- end-of-season form question: "Keen to come back next season?"
- in-app one-click "Count me in next season" for signed-in members
- referral or "invite a mate" capture
- one follow-up reminder for invited people who have not joined
- priority tags such as returning paid member or referred lead
- bounce tracking for bad email addresses
- a short free-text note for manual context

## Mapping From The Current Richer Model

If you simplify the current pipeline, the old stages can collapse like this:

- `new` -> `queued`
- `reviewed` -> `queued`
- `contacted` -> `queued`
- `invited` -> `invited`
- `joined` -> `joined`
- `payment_pending` -> `payment_pending`
- `active` -> `active`
- `archived` -> `archived`
- `unsubscribed` -> `archived` plus opt-out fields

This keeps historical data while removing extra operational steps from the day-to-day process.

## Why This Is Better

- one queue is easier to reason about than separate waitlist and invite flows
- fewer stages means less admin memory and less accidental friction
- email invite remains the main action, which matches how season-open outreach already works
- payment truth still lives on memberships instead of being duplicated
- the process stays flexible enough to add follow-ups without making them mandatory

## Recommendation

If BL-033 moves ahead, this simplified draft should be treated as the preferred direction for the next implementation pass.
