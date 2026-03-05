import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

type PlayerRow = {
  user_id: string;
  display_name: string | null;
  potential: number;
  picks: Record<string, { team: string; odds: number }>;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season"));
    const round = Number(url.searchParams.get("round"));

    // ✅ allow round=0
    if (!Number.isFinite(season) || !Number.isFinite(round) || round < 0) {
      return NextResponse.json({ ok: false, error: "Provide season and round" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // single-comp MVP
    const { data: comp, error: cErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (cErr || !comp) {
      return NextResponse.json({ ok: false, error: "No competition" }, { status: 404 });
    }

    const { data: roundRow, error: rErr } = await supabase
      .from("rounds")
      .select("id, odds_snapshot_for_time_utc")
      .eq("competition_id", comp.id)
      .eq("season", season)
      .eq("round_number", round)
      .single();

    if (rErr || !roundRow) {
      return NextResponse.json({ ok: false, error: "Round not found" }, { status: 404 });
    }

    const snapshotForTimeUtc = (roundRow as any).odds_snapshot_for_time_utc ?? null;

    const { data: matches, error: mErr } = await supabase
      .from("matches")
      .select("id, home_team, away_team")
      .eq("round_id", (roundRow as any).id);

    if (mErr) {
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
    }

    const matchList = (matches ?? []) as any[];
    const matchIds = matchList.map((m) => String(m.id));
    if (matchIds.length === 0) {
      return NextResponse.json({ ok: true, season, round, players: [] });
    }

    // Load all tips for the round (everyone)
    const { data: tips, error: tErr } = await supabase
      .from("tips")
      .select("match_id, user_id, picked_team")
      .eq("competition_id", comp.id)
      .in("match_id", matchIds);

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    // Build match team lookup
    const matchById: Record<string, { home: string; away: string }> = {};
    for (const m of matchList) {
      matchById[String(m.id)] = { home: String(m.home_team), away: String(m.away_team) };
    }

    // Load odds for these matches (locked to snapshot if present, else latest)
    let q = supabase
      .from("match_odds")
      .select("match_id, home_team, away_team, home_odds, away_odds, captured_at_utc, snapshot_for_time_utc")
      .eq("competition_id", comp.id)
      .in("match_id", matchIds);

    if (snapshotForTimeUtc) {
      q = q.eq("snapshot_for_time_utc", snapshotForTimeUtc);
    } else {
      q = q.order("snapshot_for_time_utc", { ascending: false });
    }

    q = q.order("captured_at_utc", { ascending: false });

    const { data: oddsRows, error: oErr } = await q;

    if (oErr) {
      return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 });
    }

    // Pick latest odds row per match_id
    const oddsByMatchId: Record<
      string,
      { home_team: string; away_team: string; home_odds: number; away_odds: number }
    > = {};
    for (const row of (oddsRows ?? []) as any[]) {
      const mid = String(row.match_id);
      if (!oddsByMatchId[mid]) {
        oddsByMatchId[mid] = {
          home_team: String(row.home_team),
          away_team: String(row.away_team),
          home_odds: Number(row.home_odds ?? 0),
          away_odds: Number(row.away_odds ?? 0),
        };
      }
    }

    // Collect user ids
    const userIds = Array.from(new Set((tips ?? []).map((t: any) => String(t.user_id))));

    // Load profiles display names
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    if (pErr) {
      return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
    }

    const nameById: Record<string, string | null> = {};
    (profs ?? []).forEach((p: any) => {
      nameById[String(p.id)] = p.display_name ?? null;
    });

    // Aggregate into players
    const byUser: Record<string, PlayerRow> = {};

    for (const t of tips ?? []) {
      const userId = String((t as any).user_id);
      const matchId = String((t as any).match_id);
      const team = String((t as any).picked_team ?? "");

      if (!team) continue;

      if (!byUser[userId]) {
        byUser[userId] = {
          user_id: userId,
          display_name: nameById[userId] ?? null,
          potential: 0,
          picks: {},
        };
      }

      const oddsRow = oddsByMatchId[matchId];
      const matchTeams = matchById[matchId];

      let odds = 0;
      if (oddsRow && matchTeams) {
        if (team === matchTeams.home) odds = Number(oddsRow.home_odds ?? 0);
        else if (team === matchTeams.away) odds = Number(oddsRow.away_odds ?? 0);
      }

      byUser[userId].picks[matchId] = { team, odds };
      byUser[userId].potential += odds;
    }

    const players = Object.values(byUser);

    return NextResponse.json({
      ok: true,
      season,
      round,
      players,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}