import test from "node:test";
import assert from "node:assert/strict";
import {
  findDueSnapshotRounds,
  findPendingPaymentAttention,
  findRoundsWithDueRecaps,
  findStaleResultRounds,
  shouldSurfaceNextSeasonInterestAttention,
  sortAdminAnomalies,
} from "../../lib/admin-anomalies.ts";

test("anomaly rules flag a round when its due snapshot timestamp is still missing", () => {
  const rows = findDueSnapshotRounds({
    nowMs: new Date("2026-04-10T10:00:00Z").getTime(),
    rounds: [
      {
        id: "round-1",
        round_number: 7,
        lock_time_utc: "2026-04-11T09:30:00Z",
        odds_snapshot_for_time_utc: null,
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.round_number, 7);
});

test("anomaly rules flag stale results only after the post-match grace window", () => {
  const early = findStaleResultRounds({
    nowMs: new Date("2026-04-10T14:00:00Z").getTime(),
    rounds: [
      {
        id: "round-1",
        round_number: 5,
        lock_time_utc: "2026-04-09T09:30:00Z",
        odds_snapshot_for_time_utc: "2026-04-08T21:30:00Z",
      },
    ],
    matches: [
      {
        id: "match-1",
        round_id: "round-1",
        commence_time_utc: "2026-04-10T08:00:00Z",
        winner_team: null,
      },
    ],
  });
  assert.equal(early.length, 0);

  const stale = findStaleResultRounds({
    nowMs: new Date("2026-04-10T17:00:00Z").getTime(),
    rounds: [
      {
        id: "round-1",
        round_number: 5,
        lock_time_utc: "2026-04-09T09:30:00Z",
        odds_snapshot_for_time_utc: "2026-04-08T21:30:00Z",
      },
    ],
    matches: [
      {
        id: "match-1",
        round_id: "round-1",
        commence_time_utc: "2026-04-10T08:00:00Z",
        winner_team: null,
      },
      {
        id: "match-2",
        round_id: "round-1",
        commence_time_utc: "2026-04-10T09:00:00Z",
        winner_team: "Carlton",
      },
    ],
  });

  assert.equal(stale.length, 1);
  assert.equal(stale[0]?.missing_winner_count, 1);
});

test("anomaly rules flag recap-due rounds only after all results are complete and the due window opens", () => {
  const rows = findRoundsWithDueRecaps({
    nowMs: new Date("2026-04-14T12:00:00Z").getTime(),
    rounds: [
      {
        id: "round-1",
        round_number: 4,
        lock_time_utc: "2026-04-10T09:30:00Z",
        odds_snapshot_for_time_utc: "2026-04-08T21:30:00Z",
      },
    ],
    matches: [
      {
        id: "match-1",
        round_id: "round-1",
        commence_time_utc: "2026-04-12T01:00:00Z",
        winner_team: "Carlton",
      },
      {
        id: "match-2",
        round_id: "round-1",
        commence_time_utc: "2026-04-12T04:00:00Z",
        winner_team: "Richmond",
      },
    ],
    recapRoundNumbers: [],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.round_number, 4);
});

test("anomaly rules warn about pending members only when unpaid tip lock is enabled and close to lock", () => {
  const none = findPendingPaymentAttention({
    nowMs: new Date("2026-04-10T10:00:00Z").getTime(),
    rounds: [
      {
        id: "round-1",
        round_number: 6,
        lock_time_utc: "2026-04-15T09:30:00Z",
        odds_snapshot_for_time_utc: null,
      },
    ],
    pendingMemberCount: 3,
    enforceUnpaidTipLock: true,
  });
  assert.equal(none, null);

  const warning = findPendingPaymentAttention({
    nowMs: new Date("2026-04-10T10:00:00Z").getTime(),
    rounds: [
      {
        id: "round-1",
        round_number: 6,
        lock_time_utc: "2026-04-12T09:30:00Z",
        odds_snapshot_for_time_utc: null,
      },
    ],
    pendingMemberCount: 3,
    enforceUnpaidTipLock: true,
  });

  assert.equal(warning?.round_number, 6);
  assert.equal(warning?.pending_member_count, 3);
});

test("anomaly sorting keeps critical items ahead of warnings and info", () => {
  const sorted = sortAdminAnomalies([
    {
      id: "info",
      severity: "info",
      title: "Info item",
      detail: "",
      href: "/",
      cta: "Open",
      category: "growth",
    },
    {
      id: "warning",
      severity: "warning",
      title: "Warning item",
      detail: "",
      href: "/",
      cta: "Open",
      category: "payments",
    },
    {
      id: "critical",
      severity: "critical",
      title: "Critical item",
      detail: "",
      href: "/",
      cta: "Open",
      category: "automation",
    },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["critical", "warning", "info"]
  );
});

test("next-season interest stays hidden until February in Melbourne for the target season", () => {
  assert.equal(
    shouldSurfaceNextSeasonInterestAttention({
      targetSeason: 2027,
      nowMs: new Date("2026-04-09T01:00:00Z").getTime(),
    }),
    false
  );

  assert.equal(
    shouldSurfaceNextSeasonInterestAttention({
      targetSeason: 2027,
      nowMs: new Date("2027-01-31T12:00:00Z").getTime(),
    }),
    false
  );

  assert.equal(
    shouldSurfaceNextSeasonInterestAttention({
      targetSeason: 2027,
      nowMs: new Date("2027-02-01T00:30:00Z").getTime(),
    }),
    true
  );
});
