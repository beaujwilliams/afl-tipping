-- Extend next_season_interest into a lightweight onboarding pipeline.
-- This adds workflow metadata only; competition/tipping behavior is unchanged.

alter table if exists public.next_season_interest
  add column if not exists pipeline_stage text not null default 'new',
  add column if not exists reviewed_at_utc timestamptz null,
  add column if not exists contacted_at_utc timestamptz null,
  add column if not exists invited_at_utc timestamptz null,
  add column if not exists archived_at_utc timestamptz null,
  add column if not exists archived_reason text null,
  add column if not exists linked_user_id uuid null,
  add column if not exists linked_membership_competition_id uuid null,
  add column if not exists last_contact_note text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'next_season_interest_pipeline_stage_check'
  ) then
    alter table public.next_season_interest
      add constraint next_season_interest_pipeline_stage_check
      check (
        pipeline_stage in (
          'new',
          'reviewed',
          'contacted',
          'invited',
          'joined',
          'payment_pending',
          'active',
          'archived'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'next_season_interest_archived_reason_length_check'
  ) then
    alter table public.next_season_interest
      add constraint next_season_interest_archived_reason_length_check
      check (archived_reason is null or char_length(archived_reason) <= 500);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'next_season_interest_last_contact_note_length_check'
  ) then
    alter table public.next_season_interest
      add constraint next_season_interest_last_contact_note_length_check
      check (last_contact_note is null or char_length(last_contact_note) <= 2000);
  end if;
end $$;

create index if not exists idx_next_season_interest_target_pipeline_stage
  on public.next_season_interest (target_season, pipeline_stage);

create index if not exists idx_next_season_interest_linked_user_id
  on public.next_season_interest (linked_user_id);

-- Backfill old public communication statuses into sensible initial workflow stages.
update public.next_season_interest
set
  pipeline_stage = 'invited',
  invited_at_utc = coalesce(invited_at_utc, updated_at, submitted_at_utc, now())
where pipeline_stage = 'new'
  and status = 'notified';

update public.next_season_interest
set
  pipeline_stage = 'archived',
  archived_at_utc = coalesce(archived_at_utc, updated_at, submitted_at_utc, now()),
  archived_reason = coalesce(archived_reason, 'unsubscribed')
where pipeline_stage = 'new'
  and status = 'unsubscribed';
