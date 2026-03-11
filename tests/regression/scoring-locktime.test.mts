import assert from "node:assert/strict";
import test from "node:test";
import {
  isRoundLocked,
  leaderboardRankComparator,
  normalizePaymentStatus,
  normalizeRole,
  pointsForWinningTip,
  shouldBlockTipSubmissionForPayment,
} from "../../lib/scoring-lock-rules.ts";

test("leaderboard rank comparator applies points -> accuracy -> correct tips -> name", () => {
  const rows = [
    { display_name: "Zulu", total_points: 10, accuracy_pct: 80, correct_tips: 4 },
    { display_name: "Alpha", total_points: 10, accuracy_pct: 80, correct_tips: 4 },
    { display_name: "Bravo", total_points: 10, accuracy_pct: 85, correct_tips: 4 },
    { display_name: "Charlie", total_points: 9.5, accuracy_pct: 100, correct_tips: 2 },
    { display_name: "Delta", total_points: 10, accuracy_pct: 80, correct_tips: 5 },
  ];

  const sorted = [...rows].sort(leaderboardRankComparator);
  assert.deepEqual(
    sorted.map((r) => r.display_name),
    ["Bravo", "Delta", "Alpha", "Zulu", "Charlie"]
  );
});

test("points for winning tip follow the winning team odds only", () => {
  assert.equal(
    pointsForWinningTip({
      pickedTeam: "Sydney",
      winnerTeam: "Sydney",
      homeTeam: "Sydney",
      awayTeam: "Carlton",
      homeOdds: 1.29,
      awayOdds: 3.62,
    }),
    1.29
  );

  assert.equal(
    pointsForWinningTip({
      pickedTeam: "Carlton",
      winnerTeam: "Carlton",
      homeTeam: "Sydney",
      awayTeam: "Carlton",
      homeOdds: 1.29,
      awayOdds: 3.62,
    }),
    3.62
  );

  assert.equal(
    pointsForWinningTip({
      pickedTeam: "Sydney",
      winnerTeam: "Carlton",
      homeTeam: "Sydney",
      awayTeam: "Carlton",
      homeOdds: 1.29,
      awayOdds: 3.62,
    }),
    0
  );
});

test("round lock logic enforces boundary and treats invalid lock as locked", () => {
  const nowMs = Date.UTC(2026, 2, 11, 9, 0, 0);
  const future = new Date(nowMs + 5 * 60 * 1000).toISOString();
  const atNow = new Date(nowMs).toISOString();
  const past = new Date(nowMs - 5 * 60 * 1000).toISOString();

  assert.equal(isRoundLocked(future, nowMs), false);
  assert.equal(isRoundLocked(atNow, nowMs), true);
  assert.equal(isRoundLocked(past, nowMs), true);
  assert.equal(isRoundLocked(null, nowMs), true);
  assert.equal(isRoundLocked("not-a-date", nowMs), true);
});

test("unpaid lock rules: pending members blocked, waived/paid pass, owner/admin bypass", () => {
  assert.equal(normalizeRole(" OWNER "), "owner");
  assert.equal(normalizeRole("unknown"), "member");
  assert.equal(normalizePaymentStatus(" WaIvEd "), "waived");
  assert.equal(normalizePaymentStatus(""), "pending");

  assert.equal(
    shouldBlockTipSubmissionForPayment({
      enforceUnpaidTipLock: false,
      role: "member",
      paymentStatus: "pending",
    }),
    false
  );

  assert.equal(
    shouldBlockTipSubmissionForPayment({
      enforceUnpaidTipLock: true,
      role: "member",
      paymentStatus: "pending",
    }),
    true
  );

  assert.equal(
    shouldBlockTipSubmissionForPayment({
      enforceUnpaidTipLock: true,
      role: "member",
      paymentStatus: "waived",
    }),
    false
  );

  assert.equal(
    shouldBlockTipSubmissionForPayment({
      enforceUnpaidTipLock: true,
      role: "owner",
      paymentStatus: "pending",
    }),
    false
  );
});
