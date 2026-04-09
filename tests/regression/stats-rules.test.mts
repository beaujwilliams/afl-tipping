import test from "node:test";
import assert from "node:assert/strict";
import { buildStatsPayloadFromBase } from "../../lib/stats-rules.ts";

test("stats rules build user insights and team rows from one shared season dataset", () => {
  const payload = buildStatsPayloadFromBase({
    userId: "user-1",
    base: {
      season: 2026,
      competition_id: "comp-1",
      leaderboard_rows: [
        {
          user_id: "user-1",
          display_name: "Dave",
          payment_status: "paid",
          rank: 3,
          total_points: 1.9,
          accuracy_pct: 33.3,
          behind_leader: 2.7,
          movement: -1,
          current_streak: 0,
          correct_tips: 1,
          tips_submitted: 2,
          missed_tips: 1,
          round_score: 0,
          avg_winning_odds: 1.9,
        },
        {
          user_id: "user-2",
          display_name: "John",
          payment_status: "paid",
          rank: 2,
          total_points: 2.7,
          accuracy_pct: 66.7,
          behind_leader: 1.9,
          movement: 0,
          current_streak: 1,
          correct_tips: 1,
          tips_submitted: 3,
          missed_tips: 0,
          round_score: 0,
          avg_winning_odds: 2.7,
        },
        {
          user_id: "user-3",
          display_name: "Beau",
          payment_status: "paid",
          rank: 1,
          total_points: 4.6,
          accuracy_pct: 100,
          behind_leader: 0,
          movement: 1,
          current_streak: 3,
          correct_tips: 3,
          tips_submitted: 3,
          missed_tips: 0,
          round_score: 2.3,
          avg_winning_odds: 2.3,
        },
      ],
      scored_rounds: [1, 2],
      rank_trends: [
        { user_id: "user-1", points: [{ round_number: 1, rank: 2 }, { round_number: 2, rank: 3 }] },
        { user_id: "user-2", points: [{ round_number: 1, rank: 3 }, { round_number: 2, rank: 2 }] },
        { user_id: "user-3", points: [{ round_number: 1, rank: 1 }, { round_number: 2, rank: 1 }] },
      ],
      season_teams: ["Adelaide", "Carlton", "Geelong", "Richmond", "Sydney"],
      scored_matches: [
        {
          id: "match-1",
          round_number: 1,
          commence_time_utc: "2026-03-10T09:30:00Z",
          home_team_normalized: "Carlton",
          away_team_normalized: "Richmond",
          winner_team_normalized: "Carlton",
          home_odds: 1.9,
          away_odds: 2.1,
          winner_odds: 1.9,
        },
        {
          id: "match-2",
          round_number: 2,
          commence_time_utc: "2026-03-17T09:30:00Z",
          home_team_normalized: "Geelong",
          away_team_normalized: "Richmond",
          winner_team_normalized: "Richmond",
          home_odds: 1.8,
          away_odds: 2.7,
          winner_odds: 2.7,
        },
        {
          id: "match-3",
          round_number: 2,
          commence_time_utc: "2026-03-17T12:30:00Z",
          home_team_normalized: "Adelaide",
          away_team_normalized: "Sydney",
          winner_team_normalized: "Adelaide",
          home_odds: 2.3,
          away_odds: 1.6,
          winner_odds: 2.3,
        },
      ],
      all_tips: [
        { user_id: "user-1", match_id: "match-1", picked_team: "Carlton" },
        { user_id: "user-2", match_id: "match-1", picked_team: "Richmond" },
        { user_id: "user-3", match_id: "match-1", picked_team: "Carlton" },
        { user_id: "user-1", match_id: "match-2", picked_team: "Geelong" },
        { user_id: "user-2", match_id: "match-2", picked_team: "Richmond" },
        { user_id: "user-3", match_id: "match-2", picked_team: "Richmond" },
        { user_id: "user-2", match_id: "match-3", picked_team: "Sydney" },
        { user_id: "user-3", match_id: "match-3", picked_team: "Sydney" },
      ],
    },
  });

  assert.equal(payload.snapshot?.rank, 3);
  assert.equal(payload.insights.current_streak, 0);
  assert.equal(payload.insights.longest_streak, 1);
  assert.equal(payload.insights.favourite_record.tips, 2);
  assert.equal(payload.insights.favourite_record.correct, 1);
  assert.equal(payload.insights.underdog_record.tips, 0);
  assert.equal(payload.insights.contrarian_edge.contrarian_picks, 1);
  assert.equal(payload.insights.contrarian_edge.net_points_delta, -2.7);
  assert.equal(payload.insights.missed_tips_impact.missed_tips, 1);
  assert.equal(payload.insights.missed_tips_impact.potential_points_lost, 2.3);
  assert.equal(payload.insights.best_round?.round_number, 1);
  assert.equal(payload.insights.worst_round?.round_number, 2);
  assert.equal(payload.team_totals.tipped, 2);
  assert.equal(payload.team_totals.correct, 1);
  assert.equal(payload.team_totals.incorrect, 1);
  assert.equal(payload.team_totals.total_points, 1.9);
  assert.equal(payload.team_rows.find((row) => row.team === "Carlton")?.total_points, 1.9);
  assert.equal(payload.team_rows.find((row) => row.team === "Geelong")?.incorrect_count, 1);
});
