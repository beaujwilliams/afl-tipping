export type AutomationJobKind = "snapshot_odds_due" | "prelock_reminders";
export type AutomationRunStatus = "success" | "failed" | "skipped";
export type AutomationTriggerMode = "cron" | "bearer";

type JsonObject = Record<string, unknown>;

export type AutomationRunSummary = {
  runStatus: AutomationRunStatus;
  summary: string;
};

type RecordAutomationJobRunParams = {
  competitionId: string;
  season: number;
  jobKind: AutomationJobKind;
  triggerMode: AutomationTriggerMode;
  requestPath?: string | null;
  startedAtUtc: string;
  finishedAtUtc: string;
  runStatus: AutomationRunStatus;
  summary: string;
  details: unknown;
};

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toSentenceCase(raw: string) {
  const normalized = raw.replaceAll("_", " ").trim();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function firstErrorFromResults(results: unknown) {
  if (!Array.isArray(results)) return "";
  for (const row of results) {
    const obj = asObject(row);
    const snapshotResult = asObject(obj?.snapshotResult);
    const error = readString(snapshotResult?.error);
    if (error) return error;
  }
  return "";
}

export function classifySnapshotRun(body: unknown, httpStatus: number): AutomationRunSummary {
  const obj = asObject(body);
  if (!obj) {
    return {
      runStatus: "failed",
      summary: `Snapshot request failed (${httpStatus}).`,
    };
  }

  if (httpStatus >= 400) {
    return {
      runStatus: "failed",
      summary: readString(obj.error) || `Snapshot request failed (${httpStatus}).`,
    };
  }

  if (obj.ok === false) {
    return {
      runStatus: "failed",
      summary: readString(obj.error) || "Snapshot request reported a failure.",
    };
  }

  const capturedRounds = Math.max(0, Math.trunc(readNumber(obj.capturedRounds)));
  const processedDueRounds = Math.max(0, Math.trunc(readNumber(obj.processedDueRounds)));
  const next = asObject(obj.next);
  const nextRound = Math.trunc(readNumber(next?.round));
  const skippedReason = readString(obj.skipped_reason);
  const nestedError = firstErrorFromResults(obj.results);

  if (nestedError) {
    return {
      runStatus: "failed",
      summary: nestedError,
    };
  }

  if (capturedRounds > 0) {
    return {
      runStatus: "success",
      summary: `Captured locked odds for round ${nextRound || "?"}.`,
    };
  }

  if (skippedReason) {
    if (skippedReason === "no_due_rounds_pending_capture") {
      return {
        runStatus: "skipped",
        summary: "No rounds were due for odds capture.",
      };
    }
    if (skippedReason === "already_captured_for_due_snapshot") {
      return {
        runStatus: "skipped",
        summary: `Round ${nextRound || "?"} was already captured for its due snapshot.`,
      };
    }
    if (skippedReason === "not_due_yet") {
      return {
        runStatus: "skipped",
        summary: `Next due round is ${nextRound || "?"}, but its snapshot window is not open yet.`,
      };
    }
    if (skippedReason === "completed_rounds_are_read_only") {
      return {
        runStatus: "skipped",
        summary: "Completed rounds with missing odds were left unchanged.",
      };
    }
    return {
      runStatus: "skipped",
      summary: toSentenceCase(skippedReason) || "Snapshot check skipped.",
    };
  }

  if (processedDueRounds > 0 && capturedRounds === 0) {
    return {
      runStatus: "failed",
      summary: `Processed ${processedDueRounds} due round check but captured 0 snapshots.`,
    };
  }

  return {
    runStatus: "skipped",
    summary: "Snapshot check completed with no capture required.",
  };
}

export function classifyPrelockReminderRun(body: unknown, httpStatus: number): AutomationRunSummary {
  const obj = asObject(body);
  if (!obj) {
    return {
      runStatus: "failed",
      summary: `Reminder request failed (${httpStatus}).`,
    };
  }

  if (httpStatus >= 400) {
    return {
      runStatus: "failed",
      summary: readString(obj.error) || `Reminder request failed (${httpStatus}).`,
    };
  }

  const totals = asObject(obj.totals);
  const sent = Math.max(0, Math.trunc(readNumber(totals?.sent)));
  const simulated = Math.max(0, Math.trunc(readNumber(totals?.simulated)));
  const failed = Math.max(0, Math.trunc(readNumber(totals?.failed)));
  const noEmail = Math.max(0, Math.trunc(readNumber(totals?.no_email)));
  const roundsTargeted = Math.max(0, Math.trunc(readNumber(obj.rounds_targeted)));
  const errors = Array.isArray(obj.errors) ? obj.errors : [];

  if (failed > 0 || errors.length > 0 || obj.ok === false) {
    return {
      runStatus: "failed",
      summary: `Reminder run targeted ${roundsTargeted} round(s): sent ${sent}, failed ${failed}, no email ${noEmail}.`,
    };
  }

  if (roundsTargeted === 0 && sent === 0 && simulated === 0) {
    return {
      runStatus: "skipped",
      summary: "No rounds were inside the reminder window.",
    };
  }

  return {
    runStatus: "success",
    summary: `Reminder run targeted ${roundsTargeted} round(s): sent ${sent}, simulated ${simulated}, failed ${failed}.`,
  };
}

export function summarizeScoringRun(run: {
  job_kind: string;
  scope: string;
  run_status: string;
  sync_updated: number;
  leaderboard_recalc_ran: boolean;
  leaderboard_recalc_ok: boolean | null;
  details: unknown;
}) {
  const details = asObject(run.details);
  const sync = asObject(details?.sync_results);
  const recalc = asObject(details?.recalc_leaderboard);
  const syncJson = asObject(sync?.json);
  const recalcJson = asObject(recalc?.json);

  if (run.run_status === "failed") {
    return (
      readString(syncJson?.error) ||
      readString(recalcJson?.error) ||
      "Scoring automation reported a failure."
    );
  }

  const updated = Math.max(0, Math.trunc(readNumber(run.sync_updated)));
  if (updated <= 0) {
    return "No score updates were needed.";
  }

  if (run.leaderboard_recalc_ran && run.leaderboard_recalc_ok) {
    return `Updated ${updated} result${updated === 1 ? "" : "s"} and refreshed the leaderboard.`;
  }

  if (run.leaderboard_recalc_ran && run.leaderboard_recalc_ok === false) {
    return `Updated ${updated} result${updated === 1 ? "" : "s"}, but leaderboard refresh failed.`;
  }

  return `Updated ${updated} result${updated === 1 ? "" : "s"}.`;
}

export function automationJobLabel(jobKind: string) {
  if (jobKind === "scoring_15m") return "Scoring refresh";
  if (jobKind === "scoring_daily_full") return "Daily scoring sweep";
  if (jobKind === "manual") return "Manual scoring run";
  if (jobKind === "snapshot_odds_due") return "Odds snapshot";
  if (jobKind === "prelock_reminders") return "Pre-lock reminders";
  return toSentenceCase(jobKind) || "Automation run";
}

export function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export async function recordAutomationJobRun(params: RecordAutomationJobRunParams) {
  const { createServiceClient } = await import("./supabase-server");
  const supabase = createServiceClient();
  const insert = await supabase.from("automation_job_runs").insert({
    competition_id: params.competitionId,
    season: params.season,
    job_kind: params.jobKind,
    trigger_mode: params.triggerMode,
    run_status: params.runStatus,
    request_path: params.requestPath ?? null,
    started_at_utc: params.startedAtUtc,
    finished_at_utc: params.finishedAtUtc,
    summary: params.summary,
    details: params.details,
  });

  if (!insert.error) return null;

  if (isMissingRelationError(insert.error.message, "automation_job_runs")) {
    return `${insert.error.message} (hint: apply migration db/migrations/20260407_automation_job_runs.sql)`;
  }

  return insert.error.message;
}
