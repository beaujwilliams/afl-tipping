create extension if not exists pgcrypto;

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  season integer null,
  action_type text not null check (
    action_type in (
      'sync_fixture',
      'sync_results',
      'recalc_leaderboard',
      'snapshot_odds_due',
      'member_updated',
      'member_removed',
      'payment_settings_updated',
      'champion_settings_updated'
    )
  ),
  result_status text not null default 'success' check (
    result_status in ('success', 'skipped', 'failed')
  ),
  actor_mode text not null default 'bearer' check (
    actor_mode in ('bearer', 'cron')
  ),
  actor_user_id text null,
  actor_display_name text null,
  target_type text null,
  target_user_id text null,
  target_label text null,
  summary text not null,
  request_path text null,
  details jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_log_comp_created
  on public.admin_audit_log (competition_id, created_at desc);

create index if not exists idx_admin_audit_log_action_created
  on public.admin_audit_log (action_type, created_at desc);
