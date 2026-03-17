import assert from "node:assert/strict";
import test from "node:test";
import { isSameInstant } from "../../lib/snapshot-time.ts";

const SNAPSHOT_HOURS_BEFORE_LOCK = 36;

function computeSnapshotDueTimeUtc(lockTimeUtcIso: string): string {
  const lockMs = new Date(lockTimeUtcIso).getTime();
  if (Number.isNaN(lockMs)) throw new Error("Invalid lock_time_utc");
  const dueMs = lockMs - SNAPSHOT_HOURS_BEFORE_LOCK * 60 * 60 * 1000;
  return new Date(dueMs).toISOString();
}

type RoundRow = {
  round_number: number;
  lock_time_utc: string;
  odds_snapshot_for_time_utc: string | null;
};

function pickFirstDuePendingRound(rows: RoundRow[], nowIso: string): number | null {
  const now = new Date(nowIso);
  const first = rows
    .map((r) => {
      const dueIso = computeSnapshotDueTimeUtc(r.lock_time_utc);
      const due = now >= new Date(dueIso);
      const alreadyCaptured = isSameInstant(r.odds_snapshot_for_time_utc, dueIso);
      return { round_number: r.round_number, due, alreadyCaptured };
    })
    .find((r) => r.due && !r.alreadyCaptured);
  return first?.round_number ?? null;
}

test("isSameInstant treats +00:00 and .000Z as the same snapshot time", () => {
  assert.equal(
    isSameInstant("2026-03-03T20:30:00+00:00", "2026-03-03T20:30:00.000Z"),
    true
  );
});

test("weekly scheduler progression picks round 3 only when its due window arrives", () => {
  const rounds: RoundRow[] = [
    {
      round_number: 0,
      lock_time_utc: "2026-03-05T08:30:00+00:00",
      odds_snapshot_for_time_utc: "2026-03-03T20:30:00+00:00",
    },
    {
      round_number: 1,
      lock_time_utc: "2026-03-12T08:30:00+00:00",
      odds_snapshot_for_time_utc: "2026-03-10T20:30:00+00:00",
    },
    {
      round_number: 2,
      lock_time_utc: "2026-03-19T08:30:00+00:00",
      odds_snapshot_for_time_utc: "2026-03-17T20:30:00+00:00",
    },
    {
      round_number: 3,
      lock_time_utc: "2026-03-26T08:30:00+00:00",
      odds_snapshot_for_time_utc: null,
    },
  ];

  // Before round 3 due time (2026-03-24T20:30:00Z), nothing is due.
  assert.equal(pickFirstDuePendingRound(rounds, "2026-03-24T20:29:59.000Z"), null);

  // At/after due time, round 3 becomes the next due pending round.
  assert.equal(pickFirstDuePendingRound(rounds, "2026-03-24T20:30:00.000Z"), 3);
});
