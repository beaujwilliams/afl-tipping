-- Allows admins to temporarily dismiss Inbox anomalies.

create extension if not exists pgcrypto;

create table if not exists public.admin_anomaly_dismissals (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  season integer not null,
  dismiss_key text not null,
  dismissed_by_user_id uuid null,
  dismissed_at_utc timestamptz not null default now(),
  expires_at_utc timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_admin_anomaly_dismissals_comp_season_key
  on public.admin_anomaly_dismissals (competition_id, season, dismiss_key);

create index if not exists idx_admin_anomaly_dismissals_active
  on public.admin_anomaly_dismissals (competition_id, season, expires_at_utc desc);
