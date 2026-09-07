import assert from "node:assert/strict";
import test from "node:test";
import { buildRankFluctuationSummary } from "../../lib/leaderboard-trend.ts";

test("rank fluctuation sums absolute position changes between rounds", () => {
  const summary = buildRankFluctuationSummary({
    user_id: "user-1",
    display_name: "Alex",
    points: [
      { round_number: 1, rank: 4 },
      { round_number: 2, rank: 10 },
      { round_number: 3, rank: 8 },
    ],
  });

  assert.equal(summary?.total_position_changes, 8);
  assert.equal(summary?.biggest_single_change, 6);
  assert.equal(summary?.transition_count, 2);
});

test("rank fluctuation respects the selected round range", () => {
  const summary = buildRankFluctuationSummary(
    {
      user_id: "user-1",
      display_name: "Alex",
      points: [
        { round_number: 10, rank: 4 },
        { round_number: 11, rank: 10 },
        { round_number: 12, rank: 8 },
        { round_number: 13, rank: 15 },
      ],
    },
    new Set([11, 12, 13])
  );

  assert.equal(summary?.total_position_changes, 9);
  assert.equal(summary?.start_round, 11);
  assert.equal(summary?.finish_round, 13);
});

test("rank fluctuation de-duplicates rounds and ignores invalid points", () => {
  const summary = buildRankFluctuationSummary({
    user_id: "user-1",
    display_name: "Alex",
    points: [
      { round_number: 1, rank: 4 },
      { round_number: 2, rank: Number.NaN },
      { round_number: 3, rank: 7 },
      { round_number: 3, rank: 6 },
    ],
  });

  assert.equal(summary?.total_position_changes, 2);
  assert.equal(summary?.finish_rank, 6);
});

test("rank fluctuation needs at least two ranked points", () => {
  const summary = buildRankFluctuationSummary({
    user_id: "user-1",
    display_name: "Alex",
    points: [{ round_number: 1, rank: 4 }],
  });

  assert.equal(summary, null);
});
