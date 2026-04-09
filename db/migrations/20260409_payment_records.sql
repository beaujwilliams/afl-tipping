create extension if not exists pgcrypto;

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  season integer not null check (season >= 2000 and season <= 2100),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 1000000),
  payment_method text not null default 'bank_transfer' check (
    payment_method in ('bank_transfer', 'payid', 'cash', 'other')
  ),
  payer_name text null,
  payer_email text null,
  reference_text text null,
  notes text null,
  paid_at_utc timestamptz not null,
  recorded_source text not null default 'manual' check (
    recorded_source in ('manual', 'import')
  ),
  reconciliation_status text not null default 'unmatched' check (
    reconciliation_status in ('unmatched', 'matched', 'ignored')
  ),
  matched_user_id uuid null,
  matched_onboarding_id uuid null references public.next_season_interest (id) on delete set null,
  matched_at_utc timestamptz null,
  recorded_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_records_payer_email_like_check
    check (payer_email is null or position('@' in payer_email) > 1),
  constraint payment_records_payer_name_length_check
    check (payer_name is null or char_length(payer_name) <= 200),
  constraint payment_records_reference_text_length_check
    check (reference_text is null or char_length(reference_text) <= 500),
  constraint payment_records_notes_length_check
    check (notes is null or char_length(notes) <= 2000)
);

create index if not exists idx_payment_records_comp_season_paid
  on public.payment_records (competition_id, season, paid_at_utc desc);

create index if not exists idx_payment_records_comp_season_status
  on public.payment_records (competition_id, season, reconciliation_status, paid_at_utc desc);

create index if not exists idx_payment_records_comp_matched_user
  on public.payment_records (competition_id, matched_user_id);

create index if not exists idx_payment_records_onboarding
  on public.payment_records (matched_onboarding_id);
