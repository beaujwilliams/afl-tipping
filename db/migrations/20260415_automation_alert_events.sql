-- Stores emitted automation alerts so repeated failures can be deduplicated with cooldown windows.

create extension if not exists pgcrypto;

create table if not exists public.automation_alert_events (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  season integer not null,
  alert_key text not null,
  alert_channel text not null check (alert_channel in ('email')),
  target text not null,
  context jsonb null,
  sent_at_utc timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_automation_alert_events_lookup
  on public.automation_alert_events (competition_id, season, alert_key, sent_at_utc desc);

create index if not exists idx_automation_alert_events_sent
  on public.automation_alert_events (sent_at_utc desc);
