-- Odds snapshot notification send log.
-- Used to avoid duplicate "odds are now set" emails per round snapshot.

create extension if not exists pgcrypto;

create table if not exists public.odds_snapshot_notification_emails (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  season integer not null,
  round_number integer not null,
  user_id uuid not null,
  email text not null,
  notification_type text not null default 'odds_snapshot_set_v1',
  snapshot_for_time_utc timestamptz not null,
  lock_time_utc timestamptz not null,
  status text not null check (status in ('sent', 'simulated', 'failed')),
  provider text null,
  provider_message_id text null,
  error text null,
  sent_at_utc timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (competition_id, round_id, user_id, notification_type, snapshot_for_time_utc)
);

create index if not exists idx_odds_snapshot_notification_emails_comp_round
  on public.odds_snapshot_notification_emails (competition_id, round_id);

create index if not exists idx_odds_snapshot_notification_emails_comp_user
  on public.odds_snapshot_notification_emails (competition_id, user_id);

create index if not exists idx_odds_snapshot_notification_emails_status
  on public.odds_snapshot_notification_emails (status);
