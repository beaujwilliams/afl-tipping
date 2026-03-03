import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function isAdminOrCron(req: Request): Promise<boolean> {
  const url = new URL(req.url);

  // Cron secret allowed
  const secret = url.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;
  if (secret && cronSecret && secret === cronSecret) return true;

  // Bearer token admin allowed (from Admin UI)
  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return false;

  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const authClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data } = await authClient.auth.getUser(token);
  return (data.user?.email ?? null) === ADMIN_EMAIL;
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

    // single-comp MVP
    const { data: comp, error: cErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (cErr || !comp) {
      return NextResponse.json(
        { error: "No competition found", details: cErr?.message ?? "" },
        { status: 404 }
      );
    }

    // 1) Finished matches for this competition + season
    // We join via rounds to filter season reliably.
    const { data: finishedMatches, error: mErr } = await supabase
      .from("matches")
      .select("id, home_team, away_team, winner_team, round:rounds!inner(season, competition_id)")
      .not("winner_team", "is", null)
      .eq("round.competition_id", comp.id)
      .eq("round.season", season);

    if (mErr) {
      return NextResponse.json(
        { error: "Failed to read matches", details: mErr.message },
        { status: 500 }
      );
    }

    const matchIds = (finishedMatches ?? []).map((m: any) => String(m.id));
    if (matchIds.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        matchesScored: 0,
        note: "No finished matches yet",
      });
    }

    // 2) Tips for those matches (your column is picked_team)
    const { data: tips, error: tErr } = await supabase
      .from("tips")
      .select("user_id, match_id, picked_team")
      .eq("competition_id", comp.id)
      .in("match_id", matchIds);

    if (tErr) {
      return NextResponse.json(
        { error: "Failed to read tips", details: tErr.message },
        { status: 500 }
      );
    }

    // 3) Odds for those matches from match_odds
    // Pick latest snapshot_for_time_utc per match_id (and within that, latest captured_at_utc)
    const { data: oddsRows, error: oErr } = await supabase
      .from("match_odds")
      .select("match_id, home_odds, away_odds, snapshot_for_time_utc, captured_at_utc")
      .eq("competition_id", comp.id)
      .in("match_id", matchIds)
      .order("snapshot_for_time_utc", { ascending: false })
      .order("captured_at_utc", { ascending: false });

    if (oErr) {
      return NextResponse.json(
        { error: "Failed to read match_odds", details: oErr.message },
        { status: 500 }
      );
    }

    const oddsByMatch = new Map<string, { home: number; away: number }>();
    for (const row of oddsRows ?? []) {
      const mid = String((row as any).match_id);
      if (oddsByMatch.has(mid)) continue; // first = latest due to ordering
      oddsByMatch.set(mid, {
        home: Number((row as any).home_odds ?? 0),
        away: Number((row as any).away_odds ?? 0),
      });
    }

    const matchById = new Map<string, any>();
    for (const m of finishedMatches ?? []) matchById.set(String((m as any).id), m);

    // 4) Score totals by user
    const pointsByUser = new Map<string, number>();

    for (const tip of tips ?? []) {
      const userId = String((tip as any).user_id);
      const matchId = String((tip as any).match_id);
      const picked = String((tip as any).picked_team ?? "");

      const match = matchById.get(matchId);
      if (!match) continue;

      const winner = String(match.winner_team ?? "");
      if (!winner) continue;

      const mo = oddsByMatch.get(matchId);
      if (!mo) continue;

      let pts = 0;
      if (picked === winner) {
        if (winner === match.home_team) pts = mo.home;
        else if (winner === match.away_team) pts = mo.away;
      }

      if (pts > 0) pointsByUser.set(userId, (pointsByUser.get(userId) ?? 0) + pts);
    }

    // 5) Upsert leaderboard entries (competition_id + season are required by your schema)
    const upserts = Array.from(pointsByUser.entries()).map(([user_id, total_points]) => ({
      competition_id: comp.id,
      season,
      user_id,
      total_points,
    }));

    if (upserts.length > 0) {
      const { error: upErr } = await supabase
        .from("leaderboard_entries")
        .upsert(upserts, { onConflict: "competition_id,season,user_id" });

      if (upErr) {
        return NextResponse.json(
          { error: "Failed to upsert leaderboard entries", details: upErr.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      season,
      competition_id: comp.id,
      matchesScored: (finishedMatches ?? []).length,
      usersUpdated: upserts.length,
      note:
        upserts.length === 0
          ? "No correct tips matched finished matches (or odds missing)."
          : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}