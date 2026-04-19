import { NextResponse } from "next/server";
import { CURRENT_SEASON } from "@/lib/season-config";
import { getBearer, getUserIdFromBearer } from "@/lib/admin-auth";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";
import { createServiceClient } from "@/lib/supabase-server";
import {
  assertMemberAccess,
  getEligibleMemberDirectory,
  getLockedRoundsForSeason,
} from "@/lib/audit-export";

export async function GET(req: Request) {
  try {
    const token = getBearer(req);
    if (!token) {
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }

    const userId = await getUserIdFromBearer(req);
    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const url = new URL(req.url);
    const seasonRaw = Number(url.searchParams.get("season") ?? CURRENT_SEASON);
    const season = Number.isFinite(seasonRaw)
      ? Math.trunc(seasonRaw)
      : CURRENT_SEASON;
    const explicitCompetitionId = url.searchParams.get("competition_id")?.trim() ?? null;

    const supabase = createServiceClient();
    const competitionId = await resolveCompetitionIdForSeason({
      season,
      explicitCompetitionId,
      userId,
      supabase,
    });

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    await assertMemberAccess({ supabase, competitionId, userId });

    const [lockedRounds, memberDirectory] = await Promise.all([
      getLockedRoundsForSeason({ supabase, competitionId, season }),
      getEligibleMemberDirectory({ supabase, competitionId }),
    ]);

    return NextResponse.json({
      ok: true,
      season,
      competition_id: competitionId,
      locked_rounds: lockedRounds.map((round) => ({
        round_number: round.round_number,
        lock_time_utc: round.lock_time_utc,
      })),
      members: memberDirectory.options,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message === "You are not a member of this competition." ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
