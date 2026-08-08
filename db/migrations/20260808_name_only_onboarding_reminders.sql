-- Allow admins to keep name-only reminders in the existing onboarding pipeline.
-- Public interest submissions still require an email at the API boundary.

alter table if exists public.next_season_interest
  alter column email drop not null,
  alter column email_normalized drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'next_season_interest_contact_identity_check'
  ) then
    alter table public.next_season_interest
      add constraint next_season_interest_contact_identity_check
      check (
        (
          email is not null
          and email_normalized is not null
        )
        or
        (
          email is null
          and email_normalized is null
          and nullif(btrim(full_name), '') is not null
        )
      );
  end if;
end $$;

create index if not exists idx_next_season_interest_manual_name
  on public.next_season_interest (target_season, lower(btrim(full_name)))
  where email_normalized is null;
