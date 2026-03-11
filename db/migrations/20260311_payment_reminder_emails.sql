-- Manual payment reminder send log.
-- Used for idempotency so the same season reminder is not resent accidentally.

create extension if not exists pgcrypto;

create table if not exists public.payment_reminder_emails (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  season integer not null,
  user_id uuid not null,
  email text not null,
  reminder_type text not null default 'season_payment_pending_v1',
  status text not null check (status in ('sent', 'simulated', 'failed')),
  provider text null,
  provider_message_id text null,
  error text null,
  sent_at_utc timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (competition_id, season, user_id, reminder_type)
);

create index if not exists idx_payment_reminder_emails_comp_season
  on public.payment_reminder_emails (competition_id, season);

create index if not exists idx_payment_reminder_emails_comp_user
  on public.payment_reminder_emails (competition_id, user_id);

create index if not exists idx_payment_reminder_emails_status
  on public.payment_reminder_emails (status);
