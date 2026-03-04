import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const season = Number(searchParams.get("season"));
  const round = Number(searchParams.get("round"));

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: comp } = await supabase
    .from("competitions")
    .select("id")
    .limit(1)
    .single();

  if (!comp) return NextResponse.json({ ok: false });

  const { data: roundRow } = await supabase
    .from("rounds")
    .select("id")
    .eq("competition_id", comp.id)
    .eq("season", season)
    .eq("round_number", round)
    .single();

  if (!roundRow) return NextResponse.json({ ok: false });

  const { data: matches } = await supabase
    .from("matches")
    .select("id, home_team, away_team")
    .eq("round_id", roundRow.id);

  const matchIds = matches?.map(m => m.id) ?? [];

  const { data: tips } = await supabase
    .from("tips")
    .select("user_id, match_id, picked_team")
    .in("match_id", matchIds);

  const { data: players } = await supabase
    .from("competition_members")
    .select("user_id, profiles(display_name)");

  const { data: odds } = await supabase
    .from("match_odds")
    .select("match_id, home_team, away_team, home_odds, away_odds");

  const oddsMap: Record<string, any> = {};
  odds?.forEach(o => {
    oddsMap[o.match_id] = o;
  });

  const playerMap: Record<string, any> = {};

  players?.forEach(p => {
    playerMap[p.user_id] = {
      user_id: p.user_id,
      display_name: p.profiles?.[0]?.display_name ?? "Unknown",
      picks: {},
      potential: 0
    };
  });

  tips?.forEach(t => {
    const odds = oddsMap[t.match_id];
    const pickedOdds =
      t.picked_team === odds.home_team
        ? odds.home_odds
        : odds.away_odds;

    playerMap[t.user_id].picks[t.match_id] = {
      team: t.picked_team,
      odds: pickedOdds
    };

    playerMap[t.user_id].potential += pickedOdds;
  });

  return NextResponse.json({
    ok: true,
    matches,
    players: Object.values(playerMap)
  });
}