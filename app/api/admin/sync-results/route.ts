import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

type SquiggleGame = {
  id?: number;
  date?: string;
  year?: number;
  round?: number;
  hteam?: string;
  ateam?: string;
  hscore?: number | null;
  ascore?: number | null;
  winner?: string | null;
  complete?: number | null; // 100 when final
};

function norm(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

function sameMatchTeams(aHome: string, aAway: string, bHome: string, bAway: string) {
  const ah = norm(aHome);
  const aa = norm(aAway);
  const bh = norm(bHome);
  const ba = norm(bAway);
  return (ah === bh && aa === ba) || (ah === ba && aa === bh);
}

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

  // Load round ids for this season
  const { data: rounds, error: rErr } = await supabase
    .from("rounds")
    .select("id")
    .eq("competition_id", comp.id)
    .eq("season", season);

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const roundIds = (rounds ?? []).map((r: any) => r.id);

  // Load matches in DB for season
  const { data: matches, error: mErr } = await supabase
    .from("matches")
    .select("id, commence_time_utc, home_team, away_team, winner_team, status, round_id")
    .in("round_id", roundIds);

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  if (!matches?.length) {
    return NextResponse.json({
      ok: true,
      season,
      gamesFetched: 0,
      consideredFinal: 0,
      updated: 0,
      note: "No matches in DB",
    });
  }

  // ✅ Fetch only FINAL games from Squiggle
  const gamesUrl = `https://api.squiggle.com.au/?q=games;year=${season};complete=100;format=json`;
  const res = await fetch(gamesUrl, { cache: "no-store" });
  const json = await res.json();
  const games: SquiggleGame[] = json?.games ?? [];

  let updated = 0;

  // Only games that really have winner info
  const finalGames = games.filter((g) => g.hteam && g.ateam && g.winner);

  // Match by teams (allow swapped), choose closest time if multiple
  for (const g of finalGames) {
    const candidates = (matches as any[]).filter((m) =>
      sameMatchTeams(m.home_team, m.away_team, g.hteam!, g.ateam!)
    );

    if (!candidates.length) continue;

    const gTime = g.date ? new Date(g.date).getTime() : NaN;
    const best = candidates
      .map((m) => ({
        m,
        diff: Number.isNaN(gTime) ? 0 : Math.abs(new Date(m.commence_time_utc).getTime() - gTime),
      }))
      .sort((a, b) => a.diff - b.diff)[0].m;

    const winnerTeam = norm(g.winner!);

    if (best.winner_team !== winnerTeam || best.status !== "finished") {
      const { error: uErr } = await supabase
        .from("matches")
        .update({ winner_team: winnerTeam, status: "finished" })
        .eq("id", best.id);

      if (!uErr) updated++;
    }
  }

  return NextResponse.json({
    ok: true,
    season,
    gamesFetched: games.length,
    consideredFinal: finalGames.length,
    updated,
    note: "Using complete=100 (final games only)",
  });
}