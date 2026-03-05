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
      return NextResponse.json(
        { ok: false, error: "Provide valid season and round" },
        { status: 400 }
      );
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

    const roundId = String((roundRow as any).id);
    const snapshotForTimeUtc = (roundRow as any).odds_snapshot_for_time_utc ?? null;

    // Matches in this round
    const { data: matches, error: mErr } = await supabase
      .from("matches")
      .select("id, home_team, away_team")
      .eq("round_id", roundId);

    if (mErr) {
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
    }

    const matchList = (matches ?? []) as any[];
    const matchIds = matchList.map((m) => String(m.id));

    if (matchIds.length === 0) {
      return NextResponse.json({ ok: true, season, round, players: [] });
    }

    // Build match team lookup
    const matchById: Record<string, { home: string; away: string }> = {};
    for (const m of matchList) {
      matchById[String(m.id)] = { home: String(m.home_team), away: String(m.away_team) };
    }

    // All tips for these matches (everyone)
    const { data: tips, error: tErr } = await supabase
      .from("tips")
      .select("match_id, user_id, picked_team")
      .eq("competition_id", comp.id)
      .in("match_id", matchIds);

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    const tipRows = (tips ?? []) as any[];
    if (tipRows.length === 0) {
      return NextResponse.json({ ok: true, season, round, players: [] });
    }

    // Collect user ids
    const userIds = Array.from(new Set(tipRows.map((t: any) => String(t.user_id))));

    // Load display names
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

    // ✅ Odds: fetch only the latest row per match_id (big compute saver)
    // We'll use a SQL RPC-free approach by querying and then selecting first per match on the server,
    // BUT we reduce rows dramatically by ordering and then taking first-per-match in one pass.
    let oq = supabase
      .from("match_odds")
      .select("match_id, home_odds, away_odds, captured_at_utc, snapshot_for_time_utc")
      .eq("competition_id", comp.id)
      .in("match_id", matchIds);

    if (snapshotForTimeUtc) {
      oq = oq.eq("snapshot_for_time_utc", snapshotForTimeUtc);
    } else {
      oq = oq.order("snapshot_for_time_utc", { ascending: false });
    }

    oq = oq.order("captured_at_utc", { ascending: false });

    const { data: oddsRows, error: oErr } = await oq;

    if (oErr) {
      return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 });
    }

    const oddsByMatchId: Record<string, { home_odds: number; away_odds: number }> = {};
    for (const row of (oddsRows ?? []) as any[]) {
      const mid = String(row.match_id);
      if (!oddsByMatchId[mid]) {
        oddsByMatchId[mid] = {
          home_odds: Number(row.home_odds ?? 0),
          away_odds: Number(row.away_odds ?? 0),
        };
      }
    }

    // Aggregate into players in one pass
    const byUser: Record<string, PlayerRow> = {};

    for (const t of tipRows) {
      const uid = String(t.user_id);
      const matchId = String(t.match_id);
      const team = String(t.picked_team ?? "");
      if (!team) continue;

      const matchTeams = matchById[matchId];
      if (!matchTeams) continue;

      if (!byUser[uid]) {
        byUser[uid] = {
          user_id: uid,
          display_name: nameById[uid] ?? null,
          potential: 0,
          picks: {},
        };
      }

      const o = oddsByMatchId[matchId];
      let odds = 0;

      if (o) {
        if (team === matchTeams.home) odds = Number(o.home_odds ?? 0);
        else if (team === matchTeams.away) odds = Number(o.away_odds ?? 0);
      }

      byUser[uid].picks[matchId] = { team, odds };
      byUser[uid].potential += odds;
    }

    const players = Object.values(byUser);
    players.sort((a, b) => Number(b.potential ?? 0) - Number(a.potential ?? 0));

    return NextResponse.json({ ok: true, season, round, players });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}