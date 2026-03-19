import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  getDefaultCompetitionId,
  requireAdminOrCron,
} from "@/lib/admin-auth";
import { refreshLeaderboardSnapshot } from "@/lib/leaderboard-snapshot";

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const supabase = createServiceClient();

    const competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await getDefaultCompetitionId(supabase);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const snapshot = await refreshLeaderboardSnapshot({
      season,
      competitionId,
      supabase,
    });

    return NextResponse.json({
      ok: true,
      season,
      competition_id: competitionId,
      rowsUpdated: snapshot.rows.length,
      matchesScored: snapshot.matches_scored,
      latestScoredRound: snapshot.latest_scored_round,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Unexpected error", details: message },
      { status: 500 }
    );
  }
}
