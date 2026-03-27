create extension if not exists pgcrypto;

create table if not exists public.leaderboard_groups (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  season integer not null,
  name text not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leaderboard_groups_name_not_blank check (char_length(btrim(name)) > 0),
  constraint leaderboard_groups_season_reasonable check (season >= 2000 and season <= 2100)
);

create index if not exists idx_leaderboard_groups_competition_season
  on public.leaderboard_groups (competition_id, season, created_at desc);

create table if not exists public.leaderboard_group_members (
  group_id uuid not null references public.leaderboard_groups(id) on delete cascade,
  user_id uuid not null,
  added_by_user_id uuid null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists idx_leaderboard_group_members_user
  on public.leaderboard_group_members (user_id, joined_at desc);

create table if not exists public.leaderboard_group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.leaderboard_groups(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  season integer not null,
  invited_user_id uuid not null,
  invited_by_user_id uuid not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  handled_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint leaderboard_group_invites_status_valid check (status in ('pending', 'accepted', 'declined')),
  constraint leaderboard_group_invites_user_not_self check (invited_user_id <> invited_by_user_id),
  constraint leaderboard_group_invites_season_reasonable check (season >= 2000 and season <= 2100)
);

create unique index if not exists uq_leaderboard_group_invites_pending
  on public.leaderboard_group_invites (group_id, invited_user_id)
  where status = 'pending';

create index if not exists idx_leaderboard_group_invites_pending_by_user
  on public.leaderboard_group_invites (invited_user_id, status, created_at desc);

create index if not exists idx_leaderboard_group_invites_group
  on public.leaderboard_group_invites (group_id, created_at desc);
