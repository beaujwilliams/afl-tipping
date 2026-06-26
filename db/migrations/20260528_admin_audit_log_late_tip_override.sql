alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_type_check;

alter table public.admin_audit_log
  add constraint admin_audit_log_action_type_check check (
    action_type in (
      'sync_fixture',
      'sync_results',
      'recalc_leaderboard',
      'snapshot_odds_due',
      'late_tip_override',
      'member_updated',
      'member_removed',
      'payment_settings_updated',
      'champion_settings_updated'
    )
  );
