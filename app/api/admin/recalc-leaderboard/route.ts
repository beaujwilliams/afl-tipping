import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

type MatchRow = {
  id: string;
  round_id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  winner_team: string | null;
};

type TipRow = {
  match_id: string;
  user_id: string;
  picked_team: string;
};

type OddsRow = {
  match_id: string;
  home_team: string;
  away_team: string;
  home_odds: number;
  away_odds: number;
  snapshot_for_time_utc: string;
};

type RoundRow = {
  id: string;
  odds_snapshot_for_time_utc: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const season = Number(url.searchParams.get("season") ?? "2026");

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  // single-comp MVP
  const { data: comp, error: cErr } = await supabase
    .from("competitions")
    .select("id")
    .limit(1)
    .single();

  if (cErr || !comp) return NextResponse.json({ error: "No competition found" }, { status: 404 });

  // Load rounds (need odds_snapshot_for_time_utc)
  const { data: rounds, error: rErr } = await supabase
    .from("rounds")
    .select("id, odds_snapshot_for_time_utc")
    .eq("competition_id", comp.id)
    .eq("season", season);

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const roundsList = (rounds ?? []) as RoundRow[];
  const roundIds = roundsList.map((r) => r.id);
  const roundSnapshotById: Record<string, string | null> = {};
  roundsList.forEach((r) => (roundSnapshotById[r.id] = r.odds_snapshot_for_time_utc ?? null));

  // Load finished matches with winners
  const { data: matches, error: mErr } = await supabase
    .from("matches")
    .select("id, round_id, commence_time_utc, home_team, away_team, winner_team")
    .in("round_id", roundIds)
    .not("winner_team", "is", null);

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const finishedMatches = (matches ?? []) as MatchRow[];
  const matchIds = finishedMatches.map((m) => m.id);

  if (!matchIds.length) {
    return NextResponse.json({ ok: true, season, matchesFinished: 0, note: "No finished matches yet" });
  }

  // Load tips for those matches
  const { data: tips, error: tErr } = await supabase
    .from("tips")
    .select("match_id, user_id, picked_team")
    .eq("competition_id", comp.id)
    .in("match_id", matchIds);

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  const tipsList = (tips ?? []) as TipRow[];

  // Build the set of (match_id, snapshot_for_time_utc) we need
  const neededPairs = finishedMatches
    .map((m) => ({
      match_id: m.id,
      snapshot_for_time_utc: roundSnapshotById[m.round_id],
    }))
    .filter((x) => !!x.snapshot_for_time_utc) as { match_id: string; snapshot_for_time_utc: string }[];

  // If no rounds have snapshot time recorded yet, we can’t score correctly
  if (!neededPairs.length) {
    return NextResponse.json({
      ok: true,
      season,
      matchesFinished: finishedMatches.length,
      note: "No rounds have odds_snapshot_for_time_utc set yet (run odds snapshot first).",
    });
  }

  // Fetch odds for all finished matches; we’ll pick the row with the exact snapshot_for_time_utc for that match’s round
  const { data: oddsRows, error: oErr } = await supabase
    .from("match_odds")
    .select("match_id, home_team, away_team, home_odds, away_odds, snapshot_for_time_utc")
    .eq("competition_id", comp.id)
    .in("match_id", matchIds);

  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });

  // Index odds by match_id then by snapshot_for_time_utc
  const oddsIndex: Record<string, Record<string, OddsRow>> = {};
  (oddsRows as OddsRow[] | null)?.forEach((row) => {
    oddsIndex[row.match_id] = oddsIndex[row.match_id] ?? {};
    oddsIndex[row.match_id][row.snapshot_for_time_utc] = row;
  });

  let tipsScored = 0;
  const userTotals: Record<string, number> = {};
  let skippedNoOdds = 0;

  for (const tip of tipsList) {
    const match = finishedMatches.find((m) => m.id === tip.match_id);
    if (!match || !match.winner_team) continue;

    const snapshot = roundSnapshotById[match.round_id];
    if (!snapshot) {
      skippedNoOdds++;
      continue;
    }

    const odds = oddsIndex[tip.match_id]?.[snapshot];
    if (!odds) {
      skippedNoOdds++;
      continue;
    }

    let points = 0;

    if (tip.picked_team === match.winner_team) {
      if (match.winner_team === match.home_team) points = Number(odds.home_odds);
      else if (match.winner_team === match.away_team) points = Number(odds.away_odds);
    }

    userTotals[tip.user_id] = (userTotals[tip.user_id] ?? 0) + points;

    const { error: sErr } = await supabase.from("tip_scores").upsert(
      {
        competition_id: comp.id,
        season,
        match_id: tip.match_id,
        user_id: tip.user_id,
        points,
        picked_team: tip.picked_team,
        winner_team: match.winner_team,
        calculated_at_utc: new Date().toISOString(),
      },
      { onConflict: "competition_id,season,match_id,user_id" }
    );

    if (!sErr) tipsScored++;
  }

  // Upsert leaderboard totals
  let leaderboardRows = 0;
  for (const [user_id, total] of Object.entries(userTotals)) {
    const { error: lErr } = await supabase.from("leaderboard_entries").upsert(
      {
        competition_id: comp.id,
        season,
        user_id,
        total_points: total,
        updated_at_utc: new Date().toISOString(),
      },
      { onConflict: "competition_id,season,user_id" }
    );
    if (!lErr) leaderboardRows++;
  }

  return NextResponse.json({
    ok: true,
    season,
    matchesFinished: finishedMatches.length,
    tipsScored,
    leaderboardRows,
    skippedNoOdds,
    note: "Scoring uses round odds_snapshot_for_time_utc (your 12pm rule).",
  });
}