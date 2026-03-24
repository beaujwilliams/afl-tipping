create extension if not exists pgcrypto;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid null references public.competitions(id) on delete set null,
  title text not null,
  body text not null,
  image_urls text[] not null default '{}'::text[],
  is_pinned boolean not null default false,
  is_published boolean not null default true,
  created_by_user_id uuid null,
  published_at_utc timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_not_blank check (char_length(btrim(title)) > 0),
  constraint announcements_body_not_blank check (char_length(btrim(body)) > 0)
);

create index if not exists idx_announcements_competition_published
  on public.announcements (competition_id, is_published, is_pinned desc, published_at_utc desc);

