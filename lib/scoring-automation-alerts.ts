export const ACTIVE_SCORING_FAILURE_ALERT_KEY = "scoring_15m_consecutive_failures";
export const ACTIVE_SCORING_FAILURE_ALERT_EMAIL_DEFAULT = "complicatedtips@gmail.com";
export const ACTIVE_SCORING_FAILURE_ALERT_THRESHOLD_DEFAULT = 3;
export const ACTIVE_SCORING_FAILURE_ALERT_COOLDOWN_MINUTES_DEFAULT = 180;
export const ACTIVE_SCORING_STALE_WARNING_MINUTES_DEFAULT = 20;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function readBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function countLeadingFailedRuns(rows: Array<{ run_status: string }>) {
  let failures = 0;
  for (const row of rows) {
    if (String(row.run_status ?? "").toLowerCase() !== "failed") break;
    failures += 1;
  }
  return failures;
}

export function summarizeScoringFailureFromDetails(details: unknown) {
  const detailsObj = asObject(details);
  const sync = asObject(detailsObj?.sync_results);
  const syncJson = asObject(sync?.json);
  const recalc = asObject(detailsObj?.recalc_leaderboard);
  const recalcJson = asObject(recalc?.json);

  const syncError = readString(syncJson?.error);
  if (syncError) return syncError;

  const recalcError = readString(recalcJson?.error);
  if (recalcError) return recalcError;

  return "Active scoring check failed for an unknown reason.";
}
