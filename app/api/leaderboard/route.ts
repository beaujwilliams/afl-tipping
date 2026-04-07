import { NextResponse } from "next/server";
import {
  getLeaderboardSnapshot,
  okJson,
} from "@/lib/leaderboard-snapshot";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season"));
    const includeTrendsParam = String(url.searchParams.get("include_trends") ?? "").trim();
    const includeTrends = !["0", "false", "no"].includes(includeTrendsParam.toLowerCase());

    if (!Number.isFinite(season)) {
      return NextResponse.json({ ok: false, error: "Provide a valid season" }, { status: 400 });
    }

    const payload = await getLeaderboardSnapshot({ season, includeTrends });
    return okJson(payload);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "Unexpected error", details: message },
      { status: 500 }
    );
  }
}
