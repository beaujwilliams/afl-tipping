import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  return (data.user?.email ?? null) === "beau.j.williams@gmail.com";
}

function pickGameId(g: any): string | null {
  const candidates = [g?.id, g?.gameid, g?.game, g?.uid, g?.matchid];
  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    const s = String(c).trim();
    if (s) return s;
  }
  return null;
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

    // single-comp MVP (we still use this to scope rounds)
    const { data: comp, error: compErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (compErr || !comp) {
      return NextResponse.json({ error: "No competition", details: compErr?.message }, { status: 500 });
    }

    const competitionId = String(comp.id);

    // Load all rounds for the season so we can map matches -> season via round_id
    const { data: rounds, error: roundsErr } = await supabase
      .from("rounds")
      .select("id")
      .eq("competition_id", competitionId)
      .eq("season", season);

    if (roundsErr) {
      return NextResponse.json({ error: roundsErr.message }, { status: 500 });
    }

    const roundIds = (rounds ?? []).map((r: any) => String(r.id));
    if (roundIds.length === 0) {
      return NextResponse.json({ ok: true, season, updated: 0, note: "No rounds found for this season." });
    }

    const gamesUrl = `https://api.squiggle.com.au/?q=games;year=${season};complete=100;format=json`;
    const resp = await fetch(gamesUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": "complicatedtips/1.0 (admin sync-results)",
        Accept: "application/json",
      },
    });

    const body = await resp.json();
    const rawGames: any[] = Array.isArray(body?.games) ? body.games : [];
    const games = rawGames.filter((g) => g && typeof g === "object" && !("error" in g) && !("warning" in g));

    let consideredFinal = 0;
    let updated = 0;

    let skippedNoGameId = 0;
    let skippedNoWinner = 0;
    let noDbMatch = 0;

    const updateErrors: any[] = [];

    for (const g of games) {
      const gameId = pickGameId(g);
      if (!gameId) {
        skippedNoGameId++;
        continue;
      }

      const winner = g?.winner ?? g?.winnerteam ?? null;
      if (!winner) {
        skippedNoWinner++;
        continue;
      }

      consideredFinal++;

      // ✅ find match within this season by scoping to round_ids
      const { data: matchRow, error: findErr } = await supabase
        .from("matches")
        .select("id")
        .in("round_id", roundIds)
        .eq("match_external_id", String(gameId))
        .limit(1)
        .maybeSingle();

      if (findErr) {
        updateErrors.push({ gameId, step: "find", message: findErr.message, code: (findErr as any).code ?? null });
        continue;
      }

      if (!matchRow?.id) {
        noDbMatch++;
        continue;
      }

      const { error: updErr } = await supabase
        .from("matches")
        .update({ winner_team: String(winner) })
        .eq("id", String(matchRow.id));

      if (updErr) {
        updateErrors.push({ gameId, step: "update", message: updErr.message, code: (updErr as any).code ?? null });
        continue;
      }

      updated++;
    }

    return NextResponse.json({
      ok: true,
      season,
      fetchAttempt: {
        url: gamesUrl,
        httpStatus: resp.status,
        rawGamesCount: rawGames.length,
        finalGamesFound: games.length,
        finalDataSource: "complete=100",
      },
      gamesFetched: games.length,
      consideredFinal,
      updated,
      skipped: { skippedNoGameId, skippedNoWinner, noDbMatch },
      updateErrors,
      note: "Find match via rounds(season)->round_id, then update winner_team.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}