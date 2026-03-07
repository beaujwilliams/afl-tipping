-- BL-005: manual unpaid tip lock toggle per competition.

alter table if exists public.competitions
  add column if not exists enforce_unpaid_tip_lock boolean not null default false;
