import { NextResponse } from "next/server";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";
import {
  automationJobLabel,
  isMissingRelationError,
  summarizeScoringRun,
} from "@/lib/automation-observability";
import { createServiceClient } from "@/lib/supabase-server";

type AutomationJobRunRow = {
  id: string;
  competition_id: string;
  season: number;
  job_kind: string;
  trigger_mode: string;
  run_status: string;
  request_path: string | null;
  started_at_utc: string;
  finished_at_utc: string;
  summary: string | null;
  details: unknown;
};

type ScoringRunRow = {
  id: string;
  competition_id: string;
  season: number;
  job_kind: string;
  scope: string;
  trigger_mode: string;
  run_status: string;
  sync_updated: number;
  leaderboard_recalc_ran: boolean;
  leaderboard_recalc_ok: boolean | null;
  started_at_utc: string;
  finished_at_utc: string;
  details: unknown;
};

type HealthRun = {
  source: "scoring" | "automation";
  id: string;
  competition_id: string;
  season: number;
  job_kind: string;
  job_label: string;
  trigger_mode: string;
  run_status: string;
  started_at_utc: string;
  finished_at_utc: string;
  summary: string;
  details: unknown;
};

const AUTOMATION_LATEST_JOB_KINDS = ["snapshot_odds_due", "prelock_reminders"] as const;
const SCORING_LATEST_JOB_KINDS = ["scoring_15m", "scoring_daily_full", "manual"] as const;

function toAutomationHealthRun(row: AutomationJobRunRow): HealthRun {
  return {
    source: "automation",
    id: row.id,
    competition_id: row.competition_id,
    season: row.season,
    job_kind: row.job_kind,
    job_label: automationJobLabel(row.job_kind),
    trigger_mode: row.trigger_mode,
    run_status: row.run_status,
    started_at_utc: row.started_at_utc,
    finished_at_utc: row.finished_at_utc,
    summary: row.summary?.trim() || "Automation job recorded.",
    details: row.details,
  };
}

function toScoringHealthRun(row: ScoringRunRow): HealthRun {
  return {
    source: "scoring",
    id: row.id,
    competition_id: row.competition_id,
    season: row.season,
    job_kind: row.job_kind,
    job_label: automationJobLabel(row.job_kind),
    trigger_mode: row.trigger_mode,
    run_status: row.run_status,
    started_at_utc: row.started_at_utc,
    finished_at_utc: row.finished_at_utc,
    summary: summarizeScoringRun(row),
    details: row.details,
  };
}

function compareByStartedDesc(a: HealthRun, b: HealthRun) {
  return new Date(b.started_at_utc).getTime() - new Date(a.started_at_utc).getTime();
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const limitParam = Number(url.searchParams.get("limit") ?? "30");
    const limit = Number.isFinite(limitParam)
      ? Math.max(5, Math.min(100, Math.trunc(limitParam)))
      : 30;
    const failureWindowHoursParam = Number(url.searchParams.get("failure_window_hours") ?? "72");
    const failureWindowHours = Number.isFinite(failureWindowHoursParam)
      ? Math.max(1, Math.min(24 * 14, Math.trunc(failureWindowHoursParam)))
      : 72;

    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await resolveCompetitionIdForAdminRequest(req, supabase);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    let automationRuns: HealthRun[] = [];
    let automationRunsError: string | null = null;
    let automationRunsHint: string | null = null;

    const rawAutomationRuns = await supabase
      .from("automation_job_runs")
      .select(
        "id, competition_id, season, job_kind, trigger_mode, run_status, request_path, started_at_utc, finished_at_utc, summary, details"
      )
      .eq("competition_id", competitionId)
      .eq("season", season)
      .order("started_at_utc", { ascending: false })
      .limit(limit);

    if (rawAutomationRuns.error) {
      automationRunsError = rawAutomationRuns.error.message;
      if (isMissingRelationError(rawAutomationRuns.error.message, "automation_job_runs")) {
        automationRunsHint = "Apply migration db/migrations/20260407_automation_job_runs.sql";
      }
    } else {
      automationRuns = ((rawAutomationRuns.data ?? []) as AutomationJobRunRow[]).map(
        toAutomationHealthRun
      );
    }

    let scoringRuns: HealthRun[] = [];
    let scoringRunsError: string | null = null;
    let scoringRunsHint: string | null = null;

    const rawScoringRuns = await supabase
      .from("scoring_automation_runs")
      .select(
        "id, competition_id, season, job_kind, scope, trigger_mode, run_status, sync_updated, leaderboard_recalc_ran, leaderboard_recalc_ok, started_at_utc, finished_at_utc, details"
      )
      .eq("competition_id", competitionId)
      .eq("season", season)
      .order("started_at_utc", { ascending: false })
      .limit(limit);

    if (rawScoringRuns.error) {
      scoringRunsError = rawScoringRuns.error.message;
      if (isMissingRelationError(rawScoringRuns.error.message, "scoring_automation_runs")) {
        scoringRunsHint = "Apply migration db/migrations/20260327_scoring_automation_runs.sql";
      }
    } else {
      scoringRuns = ((rawScoringRuns.data ?? []) as ScoringRunRow[]).map(toScoringHealthRun);
    }

    const failureCutoffUtc = new Date(
      Date.now() - failureWindowHours * 60 * 60 * 1000
    ).toISOString();

    const latestAutomationRuns: HealthRun[] = [];
    if (!automationRunsError) {
      const latestPerKind = await Promise.all(
        AUTOMATION_LATEST_JOB_KINDS.map(async (jobKind) => {
          const row = await supabase
            .from("automation_job_runs")
            .select(
              "id, competition_id, season, job_kind, trigger_mode, run_status, request_path, started_at_utc, finished_at_utc, summary, details"
            )
            .eq("competition_id", competitionId)
            .eq("season", season)
            .eq("job_kind", jobKind)
            .order("started_at_utc", { ascending: false })
            .limit(1);

          if (row.error) {
            if (!automationRunsError) automationRunsError = row.error.message;
            if (
              !automationRunsHint &&
              isMissingRelationError(row.error.message, "automation_job_runs")
            ) {
              automationRunsHint = "Apply migration db/migrations/20260407_automation_job_runs.sql";
            }
            return null;
          }

          return ((row.data ?? [])[0] ?? null) as AutomationJobRunRow | null;
        })
      );

      latestPerKind.forEach((row) => {
        if (row) latestAutomationRuns.push(toAutomationHealthRun(row));
      });
    }

    const latestScoringRuns: HealthRun[] = [];
    if (!scoringRunsError) {
      const latestPerKind = await Promise.all(
        SCORING_LATEST_JOB_KINDS.map(async (jobKind) => {
          const row = await supabase
            .from("scoring_automation_runs")
            .select(
              "id, competition_id, season, job_kind, scope, trigger_mode, run_status, sync_updated, leaderboard_recalc_ran, leaderboard_recalc_ok, started_at_utc, finished_at_utc, details"
            )
            .eq("competition_id", competitionId)
            .eq("season", season)
            .eq("job_kind", jobKind)
            .order("started_at_utc", { ascending: false })
            .limit(1);

          if (row.error) {
            if (!scoringRunsError) scoringRunsError = row.error.message;
            if (
              !scoringRunsHint &&
              isMissingRelationError(row.error.message, "scoring_automation_runs")
            ) {
              scoringRunsHint = "Apply migration db/migrations/20260327_scoring_automation_runs.sql";
            }
            return null;
          }

          return ((row.data ?? [])[0] ?? null) as ScoringRunRow | null;
        })
      );

      latestPerKind.forEach((row) => {
        if (row) latestScoringRuns.push(toScoringHealthRun(row));
      });
    }

    const latest = [...latestAutomationRuns, ...latestScoringRuns].sort(compareByStartedDesc);

    const automationFailures: HealthRun[] = [];
    if (!automationRunsError) {
      const failureRows = await supabase
        .from("automation_job_runs")
        .select(
          "id, competition_id, season, job_kind, trigger_mode, run_status, request_path, started_at_utc, finished_at_utc, summary, details"
        )
        .eq("competition_id", competitionId)
        .eq("season", season)
        .eq("run_status", "failed")
        .gte("started_at_utc", failureCutoffUtc)
        .order("started_at_utc", { ascending: false })
        .limit(Math.min(limit, 20));

      if (failureRows.error) {
        if (!automationRunsError) automationRunsError = failureRows.error.message;
        if (
          !automationRunsHint &&
          isMissingRelationError(failureRows.error.message, "automation_job_runs")
        ) {
          automationRunsHint = "Apply migration db/migrations/20260407_automation_job_runs.sql";
        }
      } else {
        automationFailures.push(
          ...((failureRows.data ?? []) as AutomationJobRunRow[]).map(toAutomationHealthRun)
        );
      }
    }

    const scoringFailures: HealthRun[] = [];
    if (!scoringRunsError) {
      const failureRows = await supabase
        .from("scoring_automation_runs")
        .select(
          "id, competition_id, season, job_kind, scope, trigger_mode, run_status, sync_updated, leaderboard_recalc_ran, leaderboard_recalc_ok, started_at_utc, finished_at_utc, details"
        )
        .eq("competition_id", competitionId)
        .eq("season", season)
        .eq("run_status", "failed")
        .gte("started_at_utc", failureCutoffUtc)
        .order("started_at_utc", { ascending: false })
        .limit(Math.min(limit, 20));

      if (failureRows.error) {
        if (!scoringRunsError) scoringRunsError = failureRows.error.message;
        if (
          !scoringRunsHint &&
          isMissingRelationError(failureRows.error.message, "scoring_automation_runs")
        ) {
          scoringRunsHint = "Apply migration db/migrations/20260327_scoring_automation_runs.sql";
        }
      } else {
        scoringFailures.push(
          ...((failureRows.data ?? []) as ScoringRunRow[]).map(toScoringHealthRun)
        );
      }
    }

    const recentFailures = [...automationFailures, ...scoringFailures]
      .sort(compareByStartedDesc)
      .slice(0, Math.min(limit, 20));

    const allRuns = [...automationRuns, ...scoringRuns].sort(compareByStartedDesc);
    const healthy = recentFailures.length === 0 && !automationRunsError && !scoringRunsError;

    return NextResponse.json({
      ok: true,
      healthy,
      season,
      competition_id: competitionId,
      failure_window_hours: failureWindowHours,
      latest,
      recent_failures: recentFailures,
      recent_runs: allRuns.slice(0, limit),
      sources: {
        automation_job_runs: {
          ok: !automationRunsError,
          error: automationRunsError,
          hint: automationRunsHint,
        },
        scoring_automation_runs: {
          ok: !scoringRunsError,
          error: scoringRunsError,
          hint: scoringRunsHint,
        },
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "Unexpected error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
