import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichOddsSnapshotRounds,
  selectOddsSnapshotTarget,
  type OddsSnapshotRoundRow,
} from "../../lib/odds-snapshot-scheduler.ts";
import { isSameInstant } from "../../lib/snapshot-time.ts";

function pickFirstDuePendingRound(rows: OddsSnapshotRoundRow[], nowIso: string): number | null {
  const enriched = enrichOddsSnapshotRounds(rows, new Date(nowIso).getTime());
  const first = selectOddsSnapshotTarget({
    rounds: enriched,
    force: false,
    onlyRoundRequested: false,
  });
  return first?.round_number ?? null;
}

test("isSameInstant treats +00:00 and .000Z as the same snapshot time", () => {
  assert.equal(
    isSameInstant("2026-03-03T20:30:00+00:00", "2026-03-03T20:30:00.000Z"),
    true
  );
});

test("weekly scheduler progression picks round 3 only when its due window arrives", () => {
  const rounds: OddsSnapshotRoundRow[] = [
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

test("force snapshot target still backfills the first due pending round before future rounds", () => {
  const enriched = enrichOddsSnapshotRounds(
    [
      {
        round_number: 3,
        lock_time_utc: "2026-03-26T08:30:00+00:00",
        odds_snapshot_for_time_utc: null,
      },
      {
        round_number: 4,
        lock_time_utc: "2026-04-02T08:30:00+00:00",
        odds_snapshot_for_time_utc: null,
      },
    ],
    new Date("2026-03-24T20:30:00.000Z").getTime()
  );

  const target = selectOddsSnapshotTarget({
    rounds: enriched,
    force: true,
    onlyRoundRequested: false,
  });

  assert.equal(target?.round_number, 3);
});

test("force snapshot target falls forward only when no due pending round remains", () => {
  const enriched = enrichOddsSnapshotRounds(
    [
      {
        round_number: 3,
        lock_time_utc: "2026-03-26T08:30:00+00:00",
        odds_snapshot_for_time_utc: "2026-03-24T20:30:00+00:00",
      },
      {
        round_number: 4,
        lock_time_utc: "2026-04-02T08:30:00+00:00",
        odds_snapshot_for_time_utc: null,
      },
    ],
    new Date("2026-03-24T20:30:00.000Z").getTime()
  );

  const target = selectOddsSnapshotTarget({
    rounds: enriched,
    force: true,
    onlyRoundRequested: false,
  });

  assert.equal(target?.round_number, 4);
});

test("force snapshot target skips due rounds once match results exist", () => {
  const enriched = enrichOddsSnapshotRounds(
    [
      {
        round_number: 3,
        lock_time_utc: "2026-03-26T08:30:00+00:00",
        odds_snapshot_for_time_utc: null,
        has_completed_matches: true,
      },
      {
        round_number: 4,
        lock_time_utc: "2026-04-02T08:30:00+00:00",
        odds_snapshot_for_time_utc: null,
      },
    ],
    new Date("2026-03-30T10:00:00.000Z").getTime()
  );

  const target = selectOddsSnapshotTarget({
    rounds: enriched,
    force: true,
    onlyRoundRequested: false,
  });

  assert.equal(target?.round_number, 4);
});

test("normal snapshot target also ignores completed rounds with missing odds", () => {
  const enriched = enrichOddsSnapshotRounds(
    [
      {
        round_number: 3,
        lock_time_utc: "2026-03-26T08:30:00+00:00",
        odds_snapshot_for_time_utc: null,
        has_completed_matches: true,
      },
      {
        round_number: 4,
        lock_time_utc: "2026-04-02T08:30:00+00:00",
        odds_snapshot_for_time_utc: null,
      },
    ],
    new Date("2026-03-30T10:00:00.000Z").getTime()
  );

  const target = selectOddsSnapshotTarget({
    rounds: enriched,
    force: false,
    onlyRoundRequested: false,
  });

  assert.equal(target, null);
});

test("force snapshot target returns null when every round odds snapshot is complete", () => {
  const enriched = enrichOddsSnapshotRounds(
    [
      {
        round_number: 3,
        lock_time_utc: "2026-03-26T08:30:00+00:00",
        odds_snapshot_for_time_utc: "2026-03-24T20:30:00+00:00",
      },
      {
        round_number: 4,
        lock_time_utc: "2026-04-02T08:30:00+00:00",
        odds_snapshot_for_time_utc: "2026-03-31T20:30:00+00:00",
      },
    ],
    new Date("2026-03-24T20:30:00.000Z").getTime()
  );

  const target = selectOddsSnapshotTarget({
    rounds: enriched,
    force: true,
    onlyRoundRequested: false,
  });

  assert.equal(target, null);
});
