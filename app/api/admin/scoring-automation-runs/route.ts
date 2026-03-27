import { NextResponse } from "next/server";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";
import { createServiceClient } from "@/lib/supabase-server";

type RunRow = {
  id: string;
  competition_id: string;
  season: number;
  job_kind: string;
  scope: string;
  trigger_mode: string;
  run_status: string;
  sync_ok: boolean;
  sync_updated: number;
  leaderboard_recalc_ran: boolean;
  leaderboard_recalc_ok: boolean | null;
  started_at_utc: string;
  finished_at_utc: string;
  details: unknown;
};

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const limitParam = Number(url.searchParams.get("limit") ?? "25");
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(100, Math.trunc(limitParam)))
      : 25;
    const jobKind = String(url.searchParams.get("job_kind") ?? "scoring_15m")
      .trim()
      .toLowerCase();

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

    let query = supabase
      .from("scoring_automation_runs")
      .select(
        "id, competition_id, season, job_kind, scope, trigger_mode, run_status, sync_ok, sync_updated, leaderboard_recalc_ran, leaderboard_recalc_ok, started_at_utc, finished_at_utc, details"
      )
      .eq("competition_id", competitionId)
      .eq("season", season)
      .order("started_at_utc", { ascending: false })
      .limit(limit);

    if (jobKind === "scoring_15m" || jobKind === "scoring_daily_full" || jobKind === "manual") {
      query = query.eq("job_kind", jobKind);
    }

    const runs = await query;

    if (runs.error) {
      if (isMissingRelationError(runs.error.message, "scoring_automation_runs")) {
        return NextResponse.json(
          {
            error: "scoring_automation_runs table missing or inaccessible",
            details: runs.error.message,
            hint: "Apply migration db/migrations/20260327_scoring_automation_runs.sql",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to load scoring automation runs", details: runs.error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      season,
      competition_id: competitionId,
      job_kind: jobKind || null,
      runs: (runs.data ?? []) as RunRow[],
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Unexpected error", details: message },
      { status: 500 }
    );
  }
}
