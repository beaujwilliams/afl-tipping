import { NextResponse } from "next/server";
import { getUserIdFromBearer } from "@/lib/admin-auth";
import { getRoundResultsResponse } from "@/lib/round-results-data";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season"));
    const round = Number(url.searchParams.get("round"));
    const competitionFromQS = url.searchParams.get("competition_id")?.trim() ?? null;

    if (!Number.isFinite(season) || !Number.isFinite(round) || round < 0) {
      return NextResponse.json(
        { ok: false, error: "Provide valid season and round" },
        { status: 400 }
      );
    }

    const userId = await getUserIdFromBearer(req);
    const payload = await getRoundResultsResponse({
      season,
      round,
      explicitCompetitionId: competitionFromQS,
      userId,
    });

    return NextResponse.json(payload);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message === "Round results are available only after the round locks." ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
