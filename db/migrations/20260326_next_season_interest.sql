-- Public "notify me next season" list.
-- Kept separate from auth users so in-season signup can be closed safely.

create extension if not exists pgcrypto;

create table if not exists public.next_season_interest (
  id uuid primary key default gen_random_uuid(),
  target_season integer not null check (target_season >= 2000 and target_season <= 2100),
  email text not null,
  email_normalized text not null,
  full_name text null,
  source text not null default 'public_form',
  status text not null default 'pending' check (status in ('pending', 'notified', 'unsubscribed')),
  notes text null,
  submitted_at_utc timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint next_season_interest_email_normalized_check
    check (email_normalized = lower(btrim(email_normalized))),
  constraint next_season_interest_email_like_check
    check (position('@' in email_normalized) > 1)
);

create unique index if not exists ux_next_season_interest_target_email
  on public.next_season_interest (target_season, email_normalized);

create index if not exists idx_next_season_interest_target_status
  on public.next_season_interest (target_season, status);
