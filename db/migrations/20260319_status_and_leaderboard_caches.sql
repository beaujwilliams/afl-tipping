create table if not exists public.round_tip_status_cache (
  competition_id uuid not null,
  season integer not null,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (competition_id, season)
);

create table if not exists public.leaderboard_snapshot_cache (
  competition_id uuid not null,
  season integer not null,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (competition_id, season)
);

create index if not exists idx_round_tip_status_cache_computed
  on public.round_tip_status_cache (computed_at desc);

create index if not exists idx_leaderboard_snapshot_cache_computed
  on public.leaderboard_snapshot_cache (computed_at desc);
