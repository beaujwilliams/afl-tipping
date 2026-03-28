import { NextResponse } from "next/server";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type AdminCallResult = {
  status: number;
  json: Record<string, unknown>;
};

function normalizeScope(raw: string | null) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return value === "full" ? "full" : "active";
}

function normalizeJobKind(raw: string | null, scope: "active" | "full") {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "scoring_15m" || value === "scoring_daily_full" || value === "manual") {
    return value;
  }
  return scope === "full" ? "scoring_daily_full" : "scoring_15m";
}

function parseSyncUpdated(syncJson: Record<string, unknown>) {
  if (typeof syncJson.updated === "number") return syncJson.updated;
  const parsed = Number(syncJson.updated ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export async function GET(req: Request) {
  const startedAtUtc = new Date().toISOString();

  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const scope = normalizeScope(url.searchParams.get("scope")) as "active" | "full";
    const jobKind = normalizeJobKind(
      url.searchParams.get("job_kind"),
      scope
    ) as "scoring_15m" | "scoring_daily_full" | "manual";

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

    const bearer = gate.mode === "bearer" ? gate.token : null;
    const secretQS =
      gate.mode === "cron" ? `&secret=${encodeURIComponent(gate.secret)}` : "";
    const origin = url.origin;

    async function call(path: string): Promise<AdminCallResult> {
      const headers: Record<string, string> = {};
      if (bearer) headers.Authorization = `Bearer ${bearer}`;

      const res = await fetch(origin + path, { headers, cache: "no-store" });
      const text = await res.text();
      try {
        return { status: res.status, json: JSON.parse(text) as Record<string, unknown> };
      } catch {
        return {
          status: res.status,
          json: { error: "Non-JSON response", bodyHead: text.slice(0, 500) },
        };
      }
    }

    const syncResults = await call(
      `/api/admin/sync-results?season=${season}&scope=${scope}&competition_id=${competitionId}${secretQS}`
    );

    const syncOk =
      syncResults.status >= 200 &&
      syncResults.status < 300 &&
      (syncResults.json.ok === true || syncResults.json.success === true);
    const syncUpdated = Math.max(0, Math.trunc(parseSyncUpdated(syncResults.json)));

    const shouldRecalc = syncOk && syncUpdated > 0;
    const recalcLeaderboard = shouldRecalc
      ? await call(
        `/api/admin/recalc-leaderboard?season=${season}&competition_id=${competitionId}${secretQS}`
      )
      : {
        status: 412,
        json: {
          ok: false,
          error: syncOk
            ? "Skipped recalc because sync-results.updated was 0"
            : "Skipped recalc because sync-results failed",
        },
      };

    const recalcOk =
      recalcLeaderboard.status >= 200 &&
      recalcLeaderboard.status < 300 &&
      (recalcLeaderboard.json.ok === true || recalcLeaderboard.json.success === true);
    const runStatus =
      syncOk && (!shouldRecalc || recalcOk) ? "success" : "failed";
    const finishedAtUtc = new Date().toISOString();

    const details = {
      sync_results: syncResults,
      recalc_leaderboard: recalcLeaderboard,
    };

    let logInsertError: string | null = null;
    const logInsert = await supabase.from("scoring_automation_runs").insert({
      competition_id: competitionId,
      season,
      job_kind: jobKind,
      scope,
      trigger_mode: gate.mode,
      run_status: runStatus,
      sync_ok: syncOk,
      sync_updated: syncUpdated,
      leaderboard_recalc_ran: shouldRecalc,
      leaderboard_recalc_ok: shouldRecalc ? recalcOk : null,
      started_at_utc: startedAtUtc,
      finished_at_utc: finishedAtUtc,
      details,
    });

    if (logInsert.error) {
      logInsertError = logInsert.error.message;
      if (isMissingRelationError(logInsert.error.message, "scoring_automation_runs")) {
        logInsertError =
          `${logInsert.error.message} (hint: apply migration db/migrations/20260327_scoring_automation_runs.sql)`;
      }
    }

    // Retention cleanup runs only on the once-daily full pass.
    const shouldRunLogCleanup = jobKind === "scoring_daily_full";
    const cleanupRetentionHours = 72;
    const cleanupCutoffUtc = new Date(
      Date.now() - cleanupRetentionHours * 60 * 60 * 1000
    ).toISOString();
    let logCleanupDeleted: number | null = null;
    let logCleanupError: string | null = null;

    if (shouldRunLogCleanup) {
      const cleanup = await supabase
        .from("scoring_automation_runs")
        .delete({ count: "exact" })
        .eq("competition_id", competitionId)
        .lt("started_at_utc", cleanupCutoffUtc);

      if (cleanup.error) {
        logCleanupError = cleanup.error.message;
        if (isMissingRelationError(cleanup.error.message, "scoring_automation_runs")) {
          logCleanupError =
            `${cleanup.error.message} (hint: apply migration db/migrations/20260327_scoring_automation_runs.sql)`;
        }
      } else if (typeof cleanup.count === "number") {
        logCleanupDeleted = cleanup.count;
      }
    }

    return NextResponse.json({
      ok: runStatus === "success",
      season,
      competition_id: competitionId,
      scope,
      job_kind: jobKind,
      run_status: runStatus,
      sync_updated: syncUpdated,
      recalc_triggered: shouldRecalc,
      steps: details,
      log_saved: !logInsertError,
      log_error: logInsertError,
      log_cleanup: {
        ran: shouldRunLogCleanup,
        retention_hours: cleanupRetentionHours,
        cutoff_utc: shouldRunLogCleanup ? cleanupCutoffUtc : null,
        deleted: logCleanupDeleted,
        error: logCleanupError,
      },
      started_at_utc: startedAtUtc,
      finished_at_utc: finishedAtUtc,
    });
  } catch (e: unknown) {
    const finishedAtUtc = new Date().toISOString();
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        error: "Unexpected error",
        details: message,
        started_at_utc: startedAtUtc,
        finished_at_utc: finishedAtUtc,
      },
      { status: 500 }
    );
  }
}
