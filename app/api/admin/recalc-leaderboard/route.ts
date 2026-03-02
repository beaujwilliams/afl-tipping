import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function isAdminOrCron(req: Request): Promise<boolean> {
  const url = new URL(req.url);

  // 1) Allow automation via secret
  const secret = url.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;
  if (secret && cronSecret && secret === cronSecret) return true;

  // 2) Allow admin via Bearer token (from /admin page)
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return false;

  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const authClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data } = await authClient.auth.getUser(token);
  return (data.user?.email ?? null) === "beau.j.williams@gmail.com";
}

export async function GET(req: Request) {
  try {
    const allowed = await isAdminOrCron(req);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");

    const supabase = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const { data: comp, error: compErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (compErr || !comp) {
      return NextResponse.json(
        { error: "Competition not found", details: compErr?.message },
        { status: 500 }
      );
    }

    const competitionId = comp.id as string;

    // Finished matches: winner_team is not null
    const { data: finishedMatches, error: mErr } = await supabase
      .from("matches")
      .select("id, winner_team, home_team, away_team")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .not("winner_team", "is", null);

    if (mErr) {
      return NextResponse.json({ error: "Failed to read matches", details: mErr.message }, { status: 500 });
    }

    const matchIds = (finishedMatches ?? []).map((m: any) => m.id);
    if (matchIds.length === 0) {
      return NextResponse.json({ ok: true, season, matchesScored: 0, note: "No finished matches yet" });
    }

    // Tips for those matches
    const { data: tips, error: tErr } = await supabase
      .from("tips")
      .select("user_id, match_id, tipped_team")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .in("match_id", matchIds);

    if (tErr) {
      return NextResponse.json({ error: "Failed to read tips", details: tErr.message }, { status: 500 });
    }

    // Odds snapshots for those matches
    const { data: odds, error: oErr } = await supabase
      .from("odds_snapshots")
      .select("match_id, home_odds, away_odds")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .in("match_id", matchIds);

    if (oErr) {
      return NextResponse.json({ error: "Failed to read odds snapshots", details: oErr.message }, { status: 500 });
    }

    const oddsByMatch = new Map<string, { home: number; away: number }>();
    for (const row of odds ?? []) {
      oddsByMatch.set(String((row as any).match_id), {
        home: Number((row as any).home_odds ?? 0),
        away: Number((row as any).away_odds ?? 0),
      });
    }

    const matchById = new Map<string, any>();
    for (const m of finishedMatches ?? []) matchById.set(String(m.id), m);

    // Score totals
    const pointsByUser = new Map<string, number>();

    for (const tip of tips ?? []) {
      const userId = String((tip as any).user_id);
      const matchId = String((tip as any).match_id);
      const tipped = String((tip as any).tipped_team);

      const match = matchById.get(matchId);
      if (!match) continue;

      const winner = match.winner_team as string;
      if (!winner) continue;

      const mo = oddsByMatch.get(matchId);
      if (!mo) continue;

      let pts = 0;
      if (tipped === winner) {
        if (winner === match.home_team) pts = mo.home;
        else if (winner === match.away_team) pts = mo.away;
      }

      if (pts > 0) pointsByUser.set(userId, (pointsByUser.get(userId) ?? 0) + pts);
    }

    // Upsert leaderboard_entries
    const upserts = Array.from(pointsByUser.entries()).map(([user_id, total_points]) => ({
      competition_id: competitionId,
      season,
      user_id,
      total_points,
      updated_at: new Date().toISOString(),
    }));

    if (upserts.length > 0) {
      const { error: upErr } = await supabase
        .from("leaderboard_entries")
        .upsert(upserts, { onConflict: "competition_id,season,user_id" });

      if (upErr) {
        return NextResponse.json(
          {
            error: "Failed to upsert leaderboard entries",
            details: upErr.message,
            hint: "Check unique constraint on (competition_id, season, user_id).",
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      season,
      matchesScored: (finishedMatches ?? []).length,
      usersUpdated: upserts.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}