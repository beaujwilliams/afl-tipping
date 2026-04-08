export type AdminAnomalySeverity = "critical" | "warning" | "info";

export type AdminAnomaly = {
  id: string;
  severity: AdminAnomalySeverity;
  title: string;
  detail: string;
  href: string;
  cta: string;
  category:
    | "automation"
    | "odds"
    | "results"
    | "payments"
    | "recaps"
    | "growth";
};

export type AnomalyRoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
  odds_snapshot_for_time_utc: string | null;
};

export type AnomalyMatchRow = {
  id: string;
  round_id: string;
  commence_time_utc: string | null;
  winner_team: string | null;
};

const SNAPSHOT_HOURS_BEFORE_LOCK = 36;
const RESULTS_STALE_AFTER_HOURS = 8;
const RECAP_DUE_HOURS_AFTER_FIRST = 48;
const PENDING_PAYMENT_ATTENTION_WINDOW_HOURS = 72;

function toUtcMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isSameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  const aMs = toUtcMs(a);
  const bMs = toUtcMs(b);
  return aMs !== null && bMs !== null && aMs === bMs;
}

function severityRank(value: AdminAnomalySeverity) {
  if (value === "critical") return 0;
  if (value === "warning") return 1;
  return 2;
}

export function computeSnapshotDueTimeUtc(lockTimeUtcIso: string | null | undefined) {
  const lockMs = toUtcMs(lockTimeUtcIso);
  if (lockMs === null) return null;
  const dueMs = lockMs - SNAPSHOT_HOURS_BEFORE_LOCK * 60 * 60 * 1000;
  return new Date(dueMs).toISOString();
}

export function findDueSnapshotRounds(params: {
  rounds: AnomalyRoundRow[];
  nowMs?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();

  return params.rounds
    .map((round) => {
      const snapshotForTimeUtc = computeSnapshotDueTimeUtc(round.lock_time_utc);
      const dueMs = toUtcMs(snapshotForTimeUtc);
      if (!snapshotForTimeUtc || dueMs === null || dueMs > nowMs) return null;
      if (isSameInstant(round.odds_snapshot_for_time_utc, snapshotForTimeUtc)) return null;
      return {
        round_id: round.id,
        round_number: Number(round.round_number ?? 0),
        due_at_utc: snapshotForTimeUtc,
      };
    })
    .filter((row): row is { round_id: string; round_number: number; due_at_utc: string } => !!row)
    .sort((a, b) => a.round_number - b.round_number);
}

export function findStaleResultRounds(params: {
  rounds: AnomalyRoundRow[];
  matches: AnomalyMatchRow[];
  nowMs?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();
  const matchesByRoundId = new Map<string, AnomalyMatchRow[]>();

  params.matches.forEach((match) => {
    const roundId = String(match.round_id);
    const existing = matchesByRoundId.get(roundId) ?? [];
    existing.push(match);
    matchesByRoundId.set(roundId, existing);
  });

  return params.rounds
    .map((round) => {
      const roundMatches = matchesByRoundId.get(String(round.id)) ?? [];
      if (!roundMatches.length) return null;

      const commenceTimes = roundMatches
        .map((match) => toUtcMs(match.commence_time_utc))
        .filter((value): value is number => value !== null);
      if (!commenceTimes.length) return null;

      const latestCommenceMs = Math.max(...commenceTimes);
      const staleAfterMs = latestCommenceMs + RESULTS_STALE_AFTER_HOURS * 60 * 60 * 1000;
      if (nowMs < staleAfterMs) return null;

      const missingWinnerCount = roundMatches.filter(
        (match) => String(match.winner_team ?? "").trim().length === 0
      ).length;
      if (missingWinnerCount <= 0) return null;

      return {
        round_id: round.id,
        round_number: Number(round.round_number ?? 0),
        total_matches: roundMatches.length,
        missing_winner_count: missingWinnerCount,
      };
    })
    .filter(
      (
        row
      ): row is {
        round_id: string;
        round_number: number;
        total_matches: number;
        missing_winner_count: number;
      } => !!row
    )
    .sort((a, b) => a.round_number - b.round_number);
}

export function findRoundsWithDueRecaps(params: {
  rounds: AnomalyRoundRow[];
  matches: AnomalyMatchRow[];
  recapRoundNumbers: number[];
  nowMs?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();
  const recapSet = new Set(params.recapRoundNumbers.map((value) => Number(value)));
  const matchesByRoundId = new Map<string, AnomalyMatchRow[]>();

  params.matches.forEach((match) => {
    const roundId = String(match.round_id);
    const existing = matchesByRoundId.get(roundId) ?? [];
    existing.push(match);
    matchesByRoundId.set(roundId, existing);
  });

  return params.rounds
    .map((round) => {
      const roundMatches = matchesByRoundId.get(String(round.id)) ?? [];
      if (!roundMatches.length || recapSet.has(Number(round.round_number))) return null;

      const allFinished = roundMatches.every(
        (match) => String(match.winner_team ?? "").trim().length > 0
      );
      if (!allFinished) return null;

      const commenceTimes = roundMatches
        .map((match) => toUtcMs(match.commence_time_utc))
        .filter((value): value is number => value !== null);
      if (!commenceTimes.length) return null;

      const firstGameMs = Math.min(...commenceTimes);
      const dueAtMs = firstGameMs + RECAP_DUE_HOURS_AFTER_FIRST * 60 * 60 * 1000;
      if (nowMs < dueAtMs) return null;

      return {
        round_id: round.id,
        round_number: Number(round.round_number ?? 0),
      };
    })
    .filter((row): row is { round_id: string; round_number: number } => !!row)
    .sort((a, b) => a.round_number - b.round_number);
}

export function findPendingPaymentAttention(params: {
  rounds: AnomalyRoundRow[];
  pendingMemberCount: number;
  enforceUnpaidTipLock: boolean;
  nowMs?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();
  if (!params.enforceUnpaidTipLock || params.pendingMemberCount <= 0) return null;

  const nextOpenRound = [...params.rounds]
    .filter((round) => Number(round.round_number ?? 0) > 0)
    .sort((a, b) => Number(a.round_number ?? 0) - Number(b.round_number ?? 0))
    .find((round) => {
      const lockMs = toUtcMs(round.lock_time_utc);
      return lockMs !== null && lockMs > nowMs;
    });

  if (!nextOpenRound) return null;

  const lockMs = toUtcMs(nextOpenRound.lock_time_utc);
  if (lockMs === null) return null;

  const msUntilLock = lockMs - nowMs;
  const attentionWindowMs = PENDING_PAYMENT_ATTENTION_WINDOW_HOURS * 60 * 60 * 1000;
  if (msUntilLock > attentionWindowMs) return null;

  return {
    round_id: nextOpenRound.id,
    round_number: Number(nextOpenRound.round_number ?? 0),
    pending_member_count: params.pendingMemberCount,
  };
}

export function sortAdminAnomalies(anomalies: AdminAnomaly[]) {
  return [...anomalies].sort((a, b) => {
    const severityDiff = severityRank(a.severity) - severityRank(b.severity);
    if (severityDiff !== 0) return severityDiff;
    return a.title.localeCompare(b.title);
  });
}
