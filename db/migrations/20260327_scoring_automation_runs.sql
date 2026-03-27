-- Scoring automation run log.
-- Tracks each scheduled scoring check and whether leaderboard recalc was triggered.

create extension if not exists pgcrypto;

create table if not exists public.scoring_automation_runs (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  season integer not null,
  job_kind text not null check (job_kind in ('scoring_15m', 'scoring_daily_full', 'manual')),
  scope text not null check (scope in ('active', 'full')),
  trigger_mode text not null check (trigger_mode in ('cron', 'bearer')),
  run_status text not null check (run_status in ('success', 'failed')),
  sync_ok boolean not null default false,
  sync_updated integer not null default 0,
  leaderboard_recalc_ran boolean not null default false,
  leaderboard_recalc_ok boolean null,
  started_at_utc timestamptz not null default now(),
  finished_at_utc timestamptz not null default now(),
  details jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_scoring_automation_runs_comp_season_started
  on public.scoring_automation_runs (competition_id, season, started_at_utc desc);

create index if not exists idx_scoring_automation_runs_job_status
  on public.scoring_automation_runs (job_kind, run_status, started_at_utc desc);
