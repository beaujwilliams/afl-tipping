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
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
    // Pull round_id + the LOCKED snapshot time from rounds
    const { data: finishedMatches, error: mErr } = await supabase
      .from("matches")
      .select(
        "id, round_id, home_team, away_team, winner_team, round:rounds!inner(season, competition_id, odds_snapshot_for_time_utc)"
      )
      .not("winner_team", "is", null)
      .eq("round.competition_id", comp.id)
      .eq("round.season", season);

    if (mErr) {
      return NextResponse.json(
        { error: "Failed to read matches", details: mErr.message },
        { status: 500 }
      );
    }

    const matchList = (finishedMatches ?? []) as any[];
    const matchIds = matchList.map((m) => String(m.id));

    if (matchIds.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        competition_id: comp.id,
        matchesScored: 0,
        note: "No finished matches yet",
      });
    }

    // Map match_id -> locked snapshot_for_time_utc from its round
    const lockedSnapshotByMatch = new Map<string, string>();
    let missingLockedSnapshot = 0;

    for (const m of matchList) {
      const mid = String(m.id);
      const snap = m?.round?.odds_snapshot_for_time_utc
        ? String(m.round.odds_snapshot_for_time_utc)
        : "";
      if (!snap) {
        missingLockedSnapshot++;
        continue;
      }
      lockedSnapshotByMatch.set(mid, snap);
    }

    // 2) Tips for those matches
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

    // 3) Odds rows ONLY for the locked snapshots
    // We fetch all match_ids, then filter to snapshot_for_time_utc IN (unique snapshots),
    // then keep latest captured_at_utc per match.
    const uniqueSnaps = Array.from(new Set(Array.from(lockedSnapshotByMatch.values())));

    const oddsByMatch = new Map<string, { home: number; away: number; snapshot: string }>();

    if (uniqueSnaps.length > 0) {
      const { data: oddsRows, error: oErr } = await supabase
        .from("match_odds")
        .select("match_id, home_odds, away_odds, snapshot_for_time_utc, captured_at_utc")
        .eq("competition_id", comp.id)
        .in("match_id", matchIds)
        .in("snapshot_for_time_utc", uniqueSnaps)
        .order("captured_at_utc", { ascending: false });

      if (oErr) {
        return NextResponse.json(
          { error: "Failed to read match_odds", details: oErr.message },
          { status: 500 }
        );
      }

      for (const row of oddsRows ?? []) {
        const mid = String((row as any).match_id);
        const snap = String((row as any).snapshot_for_time_utc ?? "");
        const locked = lockedSnapshotByMatch.get(mid);
        if (!locked) continue;
        if (snap !== locked) continue;

        // first one encountered is latest captured_at_utc due to ordering
        if (oddsByMatch.has(mid)) continue;

        oddsByMatch.set(mid, {
          home: Number((row as any).home_odds ?? 0),
          away: Number((row as any).away_odds ?? 0),
          snapshot: snap,
        });
      }
    }

    const matchById = new Map<string, any>();
    for (const m of matchList) matchById.set(String(m.id), m);

    // 4) Score totals by user (only using LOCKED snapshot odds)
    const pointsByUser = new Map<string, number>();
    let scoredTips = 0;
    let skippedNoLockedSnapshot = 0;
    let skippedNoOddsForLockedSnapshot = 0;

    for (const tip of tips ?? []) {
      const userId = String((tip as any).user_id);
      const matchId = String((tip as any).match_id);
      const picked = String((tip as any).picked_team ?? "");

      const match = matchById.get(matchId);
      if (!match) continue;

      const locked = lockedSnapshotByMatch.get(matchId);
      if (!locked) {
        skippedNoLockedSnapshot++;
        continue;
      }

      const winner = String(match.winner_team ?? "");
      if (!winner) continue;

      const mo = oddsByMatch.get(matchId);
      if (!mo) {
        skippedNoOddsForLockedSnapshot++;
        continue;
      }

      let pts = 0;
      if (picked === winner) {
        if (winner === match.home_team) pts = mo.home;
        else if (winner === match.away_team) pts = mo.away;
      }

      if (pts > 0) {
        scoredTips++;
        pointsByUser.set(userId, (pointsByUser.get(userId) ?? 0) + pts);
      }
    }

    // 5) Upsert leaderboard entries
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
      matchesScored: matchIds.length,
      usersUpdated: upserts.length,
      scoredTips,
      debug: {
        missingLockedSnapshot,
        skippedNoLockedSnapshot,
        skippedNoOddsForLockedSnapshot,
        uniqueLockedSnapshots: uniqueSnaps.length,
      },
      note:
        missingLockedSnapshot > 0
          ? "Some finished matches have no rounds.odds_snapshot_for_time_utc set (can’t score those yet)."
          : undefined,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}