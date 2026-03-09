-- BL-009: persisted round recap content for admin history view.

create table if not exists public.round_recaps (
  id bigserial primary key,
  competition_id uuid not null references public.competitions (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  season integer not null,
  round_number integer not null,
  recap_type text not null default 'end_of_round_v1',
  subject text not null,
  narrative_text text not null,
  raw_stats_text text not null,
  email_text text not null,
  email_html text not null,
  summary_json jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_round_recaps_unique
  on public.round_recaps (competition_id, round_id, recap_type);

create index if not exists idx_round_recaps_comp_season_round
  on public.round_recaps (competition_id, season, round_number desc);
