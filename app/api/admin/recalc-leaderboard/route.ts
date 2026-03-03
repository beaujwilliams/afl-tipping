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

  const secret = url.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;
  if (secret && cronSecret && secret === cronSecret) return true;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
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

async function tableHasColumn(
  supabase: ReturnType<typeof createClient>,
  table: string,
  column: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", table)
    .eq("column_name", column)
    .limit(1);

  if (error) return false;
  return (data?.length ?? 0) > 0;
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

    // Detect which tables have a season column
    const [matchesHasSeason, tipsHasSeason, oddsHasSeason, leaderboardHasSeason] =
      await Promise.all([
        tableHasColumn(supabase, "matches", "season"),
        tableHasColumn(supabase, "tips", "season"),
        tableHasColumn(supabase, "odds_snapshots", "season"),
        tableHasColumn(supabase, "leaderboard_entries", "season"),
      ]);

    // Finished matches
    let matchesQuery = supabase
      .from("matches")
      .select("id, winner_team, home_team, away_team")
      .not("winner_team", "is", null);

    if (matchesHasSeason) matchesQuery = matchesQuery.eq("season", season);

    const { data: finishedMatches, error: mErr } = await matchesQuery;

    if (mErr) {
      return NextResponse.json({ error: "Failed to read matches", details: mErr.message }, { status: 500 });
    }

    const matchIds = (finishedMatches ?? []).map((m: any) => m.id);
    if (matchIds.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        matchesScored: 0,
        note: "No finished matches yet",
        matchesHasSeason,
        tipsHasSeason,
        oddsHasSeason,
        leaderboardHasSeason,
      });
    }

    // Tips for finished matches
    let tipsQuery = supabase
      .from("tips")
      .select("user_id, match_id, tipped_team")
      .in("match_id", matchIds);

    if (tipsHasSeason) tipsQuery = tipsQuery.eq("season", season);

    const { data: tips, error: tErr } = await tipsQuery;

    if (tErr) {
      return NextResponse.json({ error: "Failed to read tips", details: tErr.message }, { status: 500 });
    }

    // Odds snapshots for finished matches
    let oddsQuery = supabase
      .from("odds_snapshots")
      .select("match_id, home_odds, away_odds")
      .in("match_id", matchIds);

    if (oddsHasSeason) oddsQuery = oddsQuery.eq("season", season);

    const { data: odds, error: oErr } = await oddsQuery;

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

    // Score totals by user
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

    // Upsert leaderboard entries
    const upserts = Array.from(pointsByUser.entries()).map(([user_id, total_points]) => {
      const row: any = {
        user_id,
        total_points,
        updated_at: new Date().toISOString(),
      };
      if (leaderboardHasSeason) row.season = season;
      return row;
    });

    if (upserts.length > 0) {
      const onConflict = leaderboardHasSeason ? "season,user_id" : "user_id";

      const { error: upErr } = await supabase
        .from("leaderboard_entries")
        .upsert(upserts, { onConflict });

      if (upErr) {
        return NextResponse.json(
          {
            error: "Failed to upsert leaderboard entries",
            details: upErr.message,
            hint: leaderboardHasSeason
              ? "Ensure unique constraint exists on (season, user_id)."
              : "Ensure unique constraint exists on (user_id).",
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
      schema: {
        matchesHasSeason,
        tipsHasSeason,
        oddsHasSeason,
        leaderboardHasSeason,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}