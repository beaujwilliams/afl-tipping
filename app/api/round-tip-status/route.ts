import { NextResponse } from "next/server";
import {
  getBearer,
  getUserIdFromBearer,
  isAdminBearerForCompetition,
} from "@/lib/admin-auth";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";
import { createServiceClient } from "@/lib/supabase-server";
import { getRoundTipStatusResponse } from "@/lib/round-tip-status-data";

export async function GET(req: Request) {
  try {
    const token = getBearer(req);
    if (!token) {
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const competitionFromQS = url.searchParams.get("competition_id")?.trim() ?? null;
    const includePlayerLists =
      String(url.searchParams.get("include_player_lists") ?? "1").trim() !== "0";
    const includeChampionData =
      String(url.searchParams.get("include_champion_data") ?? "1").trim() !== "0";
    const onlyRoundId = url.searchParams.get("round_id")?.trim() ?? null;

    const supabase = createServiceClient();
    const userId = await getUserIdFromBearer(req);
    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const competitionId = await resolveCompetitionIdForSeason({
      season,
      explicitCompetitionId: competitionFromQS,
      userId,
      supabase,
    });

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const admin = await isAdminBearerForCompetition(req, competitionId);
    const payload = await getRoundTipStatusResponse({
      competitionId,
      season,
      userId,
      admin,
      includePlayerLists,
      includeChampionData,
      onlyRoundId,
      supabase,
    });

    return NextResponse.json(payload);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
