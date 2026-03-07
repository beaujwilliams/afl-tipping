-- BL-021: round recap email send-log (idempotency / send-once).

create table if not exists public.round_recap_emails (
  id bigserial primary key,
  competition_id uuid not null references public.competitions (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  season integer not null,
  round_number integer not null,
  recap_type text not null default 'end_of_round_v1',
  recipient_email text not null,
  provider text,
  provider_message_id text,
  payload_json jsonb,
  sent_at timestamptz not null default now()
);

create unique index if not exists ux_round_recap_emails_unique
  on public.round_recap_emails (competition_id, round_id, recap_type, recipient_email);

create index if not exists idx_round_recap_emails_comp_season_round
  on public.round_recap_emails (competition_id, season, round_number);
