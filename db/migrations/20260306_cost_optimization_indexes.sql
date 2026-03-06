-- Cost optimization indexes.
-- These improve existing query patterns only; no tipping/scoring behavior changes.

-- Rounds lookups by competition/season/round and season listing.
create index if not exists idx_rounds_comp_season_roundnum
  on public.rounds (competition_id, season, round_number);

-- Matches lookups by round and by external game id.
create index if not exists idx_matches_round_id_commence
  on public.matches (round_id, commence_time_utc asc);

create index if not exists idx_matches_squiggle_game_id
  on public.matches (squiggle_game_id);

-- Tips lookups by competition + match/user patterns.
create index if not exists idx_tips_comp_match
  on public.tips (competition_id, match_id);

create index if not exists idx_tips_comp_user_match
  on public.tips (competition_id, user_id, match_id);

-- Membership queries and deletes.
create index if not exists idx_memberships_comp_created
  on public.memberships (competition_id, created_at asc);

create index if not exists idx_memberships_comp_user
  on public.memberships (competition_id, user_id);

-- Match odds queries for round odds + scoring snapshots.
create index if not exists idx_match_odds_comp_match_snapshot_captured
  on public.match_odds (competition_id, match_id, snapshot_for_time_utc, captured_at_utc desc);

create index if not exists idx_match_odds_comp_match_captured
  on public.match_odds (competition_id, match_id, captured_at_utc desc);

-- Chat polling/listing/reaction queries.
create index if not exists idx_chat_messages_created_at
  on public.chat_messages (created_at desc);

create index if not exists idx_chat_reactions_message
  on public.chat_reactions (message_id);

create index if not exists idx_chat_reactions_message_user_emoji
  on public.chat_reactions (message_id, user_id, emoji);

create index if not exists idx_chat_reactions_message_emoji
  on public.chat_reactions (message_id, emoji);

-- Locked tips cache and leaderboard upsert/read patterns.
create index if not exists idx_round_locked_tips_cache_comp_round
  on public.round_locked_tips_cache (competition_id, round_id);

create index if not exists idx_leaderboard_entries_comp_season_points
  on public.leaderboard_entries (competition_id, season, total_points desc);
