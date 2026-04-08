import test from "node:test";
import assert from "node:assert/strict";
import {
  computeLeaderboardGroupSummary,
  summarizeCreatorInviteStatuses,
} from "../../lib/leaderboard-group-insights.ts";

test("group summary picks leader, my rank, biggest mover, and round leader", () => {
  const summary = computeLeaderboardGroupSummary({
    currentUserId: "user-2",
    rows: [
      {
        user_id: "user-1",
        display_name: "Alice",
        rank: 1,
        behind: 0,
        total_points: 48.5,
        movement: 0,
        round_score: 6.2,
      },
      {
        user_id: "user-2",
        display_name: "Beau",
        rank: 2,
        behind: 1.15,
        total_points: 47.35,
        movement: 2,
        round_score: 8.4,
      },
      {
        user_id: "user-3",
        display_name: "Chris",
        rank: 3,
        behind: 3.8,
        total_points: 44.7,
        movement: 1,
        round_score: 7.1,
      },
    ],
  });

  assert.equal(summary.leader?.display_name, "Alice");
  assert.equal(summary.me?.display_name, "Beau");
  assert.equal(summary.me?.rank, 2);
  assert.equal(summary.biggestMover?.display_name, "Beau");
  assert.equal(summary.roundLeader?.display_name, "Beau");
});

test("group summary returns null slots cleanly when there is no current user or positive mover", () => {
  const summary = computeLeaderboardGroupSummary({
    currentUserId: null,
    rows: [
      {
        user_id: "user-1",
        display_name: "Alice",
        rank: 1,
        behind: 0,
        total_points: 48.5,
        movement: 0,
        round_score: 6.2,
      },
    ],
  });

  assert.equal(summary.leader?.display_name, "Alice");
  assert.equal(summary.me, null);
  assert.equal(summary.biggestMover, null);
  assert.equal(summary.roundLeader?.display_name, "Alice");
});

test("creator invite status summary counts all statuses", () => {
  const counts = summarizeCreatorInviteStatuses([
    { statusKey: "member" },
    { statusKey: "member" },
    { statusKey: "pending" },
    { statusKey: "declined" },
    { statusKey: "not_invited" },
  ]);

  assert.deepEqual(counts, {
    pending: 1,
    declined: 1,
    not_invited: 1,
    member: 2,
    accepted: 0,
  });
});
