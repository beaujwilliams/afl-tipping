import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const seasonParam = url.searchParams.get("season");
    const roundParam = url.searchParams.get("round");

    const season = Number(seasonParam);
    const round = Number(roundParam);

    // ✅ allow round = 0 but reject invalid numbers
    if (!Number.isFinite(season) || !Number.isFinite(round) || round < 0) {
      return NextResponse.json(
        { error: "Provide valid season and round" },
        { status: 400 }
      );
    }

    // service role (server-only)
    const supabase = createServiceClient();

    // single-comp MVP
    const { data: comp } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (!comp) {
      return NextResponse.json({ error: "No competition" }, { status: 404 });
    }

    const { data: roundRow } = await supabase
      .from("rounds")
      .select("id, lock_time_utc")
      .eq("competition_id", comp.id)
      .eq("season", season)
      .eq("round_number", round)
      .single();

    if (!roundRow) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }

    const { data: matches } = await supabase
      .from("matches")
      .select("id, home_team, away_team")
      .eq("round_id", roundRow.id);

    const matchIds = (matches ?? []).map((m: any) => String(m.id));

    if (!matchIds.length) {
      return NextResponse.json({
        ok: true,
        season,
        round,
        byMatch: {},
      });
    }

    // Pull all tips for those matches
    const { data: tips, error: tErr } = await supabase
      .from("tips")
      .select("match_id, picked_team")
      .eq("competition_id", comp.id)
      .in("match_id", matchIds);

    if (tErr) {
      return NextResponse.json({ error: tErr.message }, { status: 500 });
    }

    // Aggregate
    const byMatch: Record<string, Record<string, number>> = {};

    for (const t of tips ?? []) {
      const mid = String((t as any).match_id);
      const team = String((t as any).picked_team ?? "");

      if (!team) continue;

      if (!byMatch[mid]) byMatch[mid] = {};
      byMatch[mid][team] = (byMatch[mid][team] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      season,
      round,
      competition_id: comp.id,
      byMatch,
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}