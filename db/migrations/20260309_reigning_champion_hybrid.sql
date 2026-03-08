-- BL-022: reigning champion hybrid model.
-- 1) Historical season champions table.
-- 2) Manual competition-level override for current crown display.

create table if not exists public.season_champions (
  id bigserial primary key,
  competition_id uuid not null references public.competitions (id) on delete cascade,
  season integer not null,
  user_id uuid not null,
  source text not null default 'manual',
  note text,
  awarded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_season_champions_comp_season
  on public.season_champions (competition_id, season);

create index if not exists idx_season_champions_comp_user
  on public.season_champions (competition_id, user_id);

alter table if exists public.competitions
  add column if not exists reigning_champion_override_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'competitions_reigning_champion_override_user_id_fkey'
  ) then
    alter table public.competitions
      add constraint competitions_reigning_champion_override_user_id_fkey
      foreign key (reigning_champion_override_user_id)
      references public.profiles (id)
      on delete set null;
  end if;
end;
$$;
