import { NextResponse } from "next/server";
import {
  getLeaderboardSnapshot,
  okJson,
} from "@/lib/leaderboard-snapshot";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season"));

    if (!Number.isFinite(season)) {
      return NextResponse.json({ ok: false, error: "Provide a valid season" }, { status: 400 });
    }

    const payload = await getLeaderboardSnapshot({ season });
    return okJson(payload);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "Unexpected error", details: message },
      { status: 500 }
    );
  }
}
