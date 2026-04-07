import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import {
  requireAdminOrCron,
} from "@/lib/admin-auth";
import { refreshLeaderboardSnapshot } from "@/lib/leaderboard-snapshot";

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });
    const actorUserId = gate.mode === "bearer" ? gate.userId : null;

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const snapshot = await refreshLeaderboardSnapshot({
      season,
      competitionId: gate.mode === "bearer" ? gate.competitionId : undefined,
    });

    const payload = {
      ok: true,
      season,
      competition_id: snapshot.competition_id,
      rowsUpdated: snapshot.rows.length,
      matchesScored: snapshot.matches_scored,
      latestScoredRound: snapshot.latest_scored_round,
    };

    const resultStatus = snapshot.rows.length > 0 || snapshot.matches_scored > 0 ? "success" : "skipped";
    const auditError = await recordAdminAuditEvent({
      competitionId: snapshot.competition_id,
      season,
      actionType: "recalc_leaderboard",
      resultStatus,
      actorMode: gate.mode,
      actorUserId,
      targetType: "season",
      targetLabel: `Season ${season}`,
      summary:
        resultStatus === "success"
          ? `Recalculated leaderboard for season ${season}: ${snapshot.rows.length} rows updated, latest scored round ${snapshot.latest_scored_round ?? "n/a"}.`
          : `Checked leaderboard recalculation for season ${season}: no rows were updated.`,
      requestPath: url.pathname + url.search,
      details: payload,
    });
    if (auditError) {
      console.warn("admin audit log failed after leaderboard recalc", auditError);
    }

    return NextResponse.json(payload);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Unexpected error", details: message },
      { status: 500 }
    );
  }
}
