import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LEADERBOARD_SORT_DIRECTION,
  DEFAULT_LEADERBOARD_SORT_KEY,
  sortLeaderboardRows,
} from "../../lib/leaderboard-sort.ts";
import { buildRoundTipStatusPlayerLists } from "../../lib/round-tip-status-rules.ts";

test("leaderboard defaults to total points descending", () => {
  assert.equal(DEFAULT_LEADERBOARD_SORT_KEY, "total_points");
  assert.equal(DEFAULT_LEADERBOARD_SORT_DIRECTION, "desc");
});

test("leaderboard default sort keeps total points order with rules-based tie breaks", () => {
  const rows = [
    {
      user_id: "u-z",
      display_name: "Zulu",
      rank: 4,
      total_points: 10,
      correct_tips: 4,
      accuracy_pct: 80,
      round_score: 2,
      movement: 0,
      behind_leader: 0,
      current_streak: 1,
      avg_winning_odds: 1.5,
    },
    {
      user_id: "u-a",
      display_name: "Alpha",
      rank: 3,
      total_points: 10,
      correct_tips: 4,
      accuracy_pct: 80,
      round_score: 2,
      movement: 0,
      behind_leader: 0,
      current_streak: 2,
      avg_winning_odds: 1.7,
    },
    {
      user_id: "u-b",
      display_name: "Bravo",
      rank: 1,
      total_points: 10,
      correct_tips: 4,
      accuracy_pct: 85,
      round_score: 1,
      movement: 1,
      behind_leader: 0,
      current_streak: 4,
      avg_winning_odds: 1.4,
    },
    {
      user_id: "u-c",
      display_name: "Charlie",
      rank: 5,
      total_points: 9.5,
      correct_tips: 6,
      accuracy_pct: 100,
      round_score: 3,
      movement: -1,
      behind_leader: 0.5,
      current_streak: 0,
      avg_winning_odds: 1.9,
    },
    {
      user_id: "u-d",
      display_name: "Delta",
      rank: 2,
      total_points: 10,
      correct_tips: 5,
      accuracy_pct: 80,
      round_score: 2,
      movement: 2,
      behind_leader: 0,
      current_streak: 3,
      avg_winning_odds: 1.8,
    },
  ];

  const sorted = sortLeaderboardRows(rows);

  assert.deepEqual(
    sorted.map((row) => row.display_name),
    ["Bravo", "Delta", "Alpha", "Zulu", "Charlie"]
  );
});

test("round tip lists group fully tipped members separately and sort names predictably", () => {
  const grouped = buildRoundTipStatusPlayerLists({
    memberIds: ["u-z", "u-a", "u-b", "u-none"],
    totalMatches: 3,
    profileNameByUserId: new Map([
      ["u-z", "Zoe"],
      ["u-a", "Aaron"],
      ["u-b", "brad"],
      ["u-none", null],
    ]),
    paymentStatusByUserId: new Map([
      ["u-z", "paid"],
      ["u-a", "pending"],
      ["u-b", "waived"],
      ["u-none", null],
    ]),
    tipCountByUserId: new Map([
      ["u-z", 3],
      ["u-a", 4],
      ["u-b", 1],
      ["u-none", 0],
    ]),
  });

  assert.equal(grouped.tippedCount, 2);
  assert.equal(grouped.missingCount, 2);
  assert.deepEqual(
    grouped.tippedPlayers.map((player) => [player.user_id, player.tips_entered]),
    [
      ["u-a", 3],
      ["u-z", 3],
    ]
  );
  assert.deepEqual(
    grouped.missingPlayers.map((player) => [player.user_id, player.tips_entered]),
    [
      ["u-b", 1],
      ["u-none", 0],
    ]
  );
});

test("round tip lists keep everyone in missing when a round has zero matches", () => {
  const grouped = buildRoundTipStatusPlayerLists({
    memberIds: ["u-a", "u-b"],
    totalMatches: 0,
    profileNameByUserId: new Map([
      ["u-a", "Alice"],
      ["u-b", "Bob"],
    ]),
    paymentStatusByUserId: new Map([
      ["u-a", "paid"],
      ["u-b", "pending"],
    ]),
    tipCountByUserId: new Map([
      ["u-a", 5],
      ["u-b", 2],
    ]),
  });

  assert.equal(grouped.tippedCount, 0);
  assert.equal(grouped.missingCount, 2);
  assert.deepEqual(
    grouped.missingPlayers.map((player) => [player.user_id, player.tips_entered]),
    [
      ["u-a", 0],
      ["u-b", 0],
    ]
  );
});
