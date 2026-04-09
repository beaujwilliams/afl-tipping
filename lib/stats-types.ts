export type StatsSnapshot = {
  rank: number;
  total_points: number;
  accuracy_pct: number;
  behind_leader: number;
  movement: number;
  current_streak: number;
  correct_tips: number;
  tips_submitted: number;
  missed_tips: number;
  round_score: number;
  avg_winning_odds: number;
};

export type StatsInsights = {
  current_streak: number;
  longest_streak: number;
  underdog_record: { tips: number; correct: number; incorrect: number; points: number };
  favourite_record: { tips: number; correct: number; incorrect: number; points: number };
  risk_profile: { avg_tipped_odds: number; comp_avg_tipped_odds: number; delta_vs_comp: number };
  contrarian_edge: {
    contrarian_picks: number;
    rounds_with_contrarian_pick: number;
    net_points_delta: number;
    gained_rounds: number;
    lost_rounds: number;
  };
  best_round: { round_number: number; score: number; movement: number } | null;
  worst_round: { round_number: number; score: number; movement: number } | null;
  points_vs_comp_avg: { user_points: number; comp_avg_points: number; delta: number };
  missed_tips_impact: { missed_tips: number; potential_points_lost: number };
};

export type TeamStatsRow = {
  team: string;
  tipped_count: number;
  correct_count: number;
  incorrect_count: number;
  accuracy_pct: number;
  total_points: number;
  avg_points_per_tip: number;
  avg_points_per_correct: number;
};

export type TeamStatsTotals = {
  tipped: number;
  correct: number;
  incorrect: number;
  total_points: number;
};

export type StatsLeaderboardRow = StatsSnapshot & {
  user_id: string;
  display_name: string;
  payment_status: string | null;
};

export type StatsRankTrendSeries = {
  user_id: string;
  points: Array<{ round_number: number; rank: number }>;
};

export type StatsPagePayload = {
  season: number;
  competition_id: string | null;
  snapshot: StatsSnapshot | null;
  insights: StatsInsights;
  team_rows: TeamStatsRow[];
  team_totals: TeamStatsTotals;
};
