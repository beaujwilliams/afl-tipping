-- BL-005: payment tracking on memberships.
-- Optional lockout can rely on this field in application logic.

alter table if exists public.memberships
  add column if not exists payment_status text not null default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'memberships_payment_status_check'
  ) then
    alter table public.memberships
      add constraint memberships_payment_status_check
      check (payment_status in ('paid', 'pending', 'waived'));
  end if;
end;
$$;

create index if not exists idx_memberships_comp_payment_status
  on public.memberships (competition_id, payment_status);
