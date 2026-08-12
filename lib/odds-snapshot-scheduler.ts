import { isSameInstant } from "./snapshot-time.ts";

export const ODDS_SNAPSHOT_HOURS_BEFORE_LOCK = 36;

export type OddsSnapshotRoundRow = {
  round_number: number;
  lock_time_utc: string;
  odds_snapshot_for_time_utc: string | null;
  has_completed_matches?: boolean;
};

export type EnrichedOddsSnapshotRound = {
  round_number: number;
  lock_time_utc: string;
  storedSnapshotForTimeUtc: string | null;
  snapshotForTimeUtc: string;
  due: boolean;
  alreadyCaptured: boolean;
  hasCompletedMatches: boolean;
};

export function computeOddsSnapshotDueTimeUtc(lockTimeUtcIso: string): string {
  const lockMs = new Date(lockTimeUtcIso).getTime();
  if (Number.isNaN(lockMs)) throw new Error("Invalid lock_time_utc");

  const dueMs = lockMs - ODDS_SNAPSHOT_HOURS_BEFORE_LOCK * 60 * 60 * 1000;
  return new Date(dueMs).toISOString();
}

export function enrichOddsSnapshotRounds(
  rounds: OddsSnapshotRoundRow[],
  nowMs = Date.now()
): EnrichedOddsSnapshotRound[] {
  return rounds.map((round) => {
    const snapshotForTimeUtc = computeOddsSnapshotDueTimeUtc(round.lock_time_utc);
    const due = nowMs >= new Date(snapshotForTimeUtc).getTime();
    const alreadyCaptured = isSameInstant(
      round.odds_snapshot_for_time_utc,
      snapshotForTimeUtc
    );

    return {
      round_number: round.round_number,
      lock_time_utc: round.lock_time_utc,
      storedSnapshotForTimeUtc: round.odds_snapshot_for_time_utc,
      snapshotForTimeUtc,
      due,
      alreadyCaptured,
      hasCompletedMatches: round.has_completed_matches === true,
    };
  });
}

export function findNextUpcomingPendingOddsSnapshotRound(
  rounds: EnrichedOddsSnapshotRound[]
): EnrichedOddsSnapshotRound | null {
  return (
    rounds.find(
      (round) =>
        !round.due && !round.alreadyCaptured && !round.hasCompletedMatches
    ) ?? null
  );
}

export function selectOddsSnapshotTarget(params: {
  rounds: EnrichedOddsSnapshotRound[];
  force: boolean;
  onlyRoundRequested: boolean;
}): EnrichedOddsSnapshotRound | null {
  const { rounds, force, onlyRoundRequested } = params;
  if (onlyRoundRequested) return rounds[0] ?? null;

  const firstDuePendingRound =
    rounds.find(
      (round) => round.due && !round.alreadyCaptured && !round.hasCompletedMatches
    ) ?? null;
  if (!force) return firstDuePendingRound;

  return (
    firstDuePendingRound ??
    findNextUpcomingPendingOddsSnapshotRound(rounds)
  );
}
