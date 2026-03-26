alter table if exists public.memberships
  add column if not exists is_test_account boolean not null default false;

create index if not exists idx_memberships_competition_test
  on public.memberships (competition_id, is_test_account);
