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

function parseTotalScore(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  const s = String(v).trim();
  if (!s) return null;

  if (s.includes(".")) {
    const parts = s.split(".").map((x) => x.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    const n = Number(last);
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isFinalGame(g: any): boolean {
  if (Number(g?.complete) === 100) return true;
  const hs = parseTotalScore(g?.hscore);
  const as = parseTotalScore(g?.ascore);
  return hs !== null && as !== null;
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

function winnerFromTotals(g: any): { winner: string | null; homeTotal: number | null; awayTotal: number | null } {
  const homeTotal = parseTotalScore(g?.hscore);
  const awayTotal = parseTotalScore(g?.ascore);

  const explicitWinner = g?.winner ?? g?.winnerteam ?? null;
  if (explicitWinner) return { winner: String(explicitWinner), homeTotal, awayTotal };

  const hName = g?.hteam ?? null;
  const aName = g?.ateam ?? null;

  if (homeTotal === null || awayTotal === null) return { winner: null, homeTotal, awayTotal };
  if (!hName || !aName) return { winner: null, homeTotal, awayTotal };

  if (homeTotal > awayTotal) return { winner: String(hName), homeTotal, awayTotal };
  if (awayTotal > homeTotal) return { winner: String(aName), homeTotal, awayTotal };

  return { winner: null, homeTotal, awayTotal };
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

    const competitionId = String(comp.id);

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

    let updated = 0;
    let consideredFinal = 0;

    let skippedNoGameId = 0;
    let skippedNotFinal = 0;
    let skippedNoWinner = 0;
    let noDbMatch = 0;

    // ✅ NEW: surface DB update errors
    const updateErrors: any[] = [];

    for (const g of games) {
      const gameId = pickGameId(g);
      if (!gameId) {
        skippedNoGameId++;
        continue;
      }

      if (!isFinalGame(g)) {
        skippedNotFinal++;
        continue;
      }

      const { winner, homeTotal, awayTotal } = winnerFromTotals(g);
      if (!winner) {
        skippedNoWinner++;
        continue;
      }

      consideredFinal++;

      // Keep patch minimal (avoids “column does not exist” problems)
      const patch: any = {
        winner_team: String(winner),
      };

      // only include scores if we actually parsed them
      if (homeTotal !== null) patch.home_score = homeTotal;
      if (awayTotal !== null) patch.away_score = awayTotal;

      const { data: upd, error: updErr } = await supabase
        .from("matches")
        .update(patch)
        .eq("competition_id", competitionId)
        .eq("season", season)
        .eq("match_external_id", String(gameId))
        .select("id")
        .limit(1);

      if (updErr) {
        updateErrors.push({
          gameId,
          message: updErr.message,
          details: (updErr as any).details ?? null,
          hint: (updErr as any).hint ?? null,
          code: (updErr as any).code ?? null,
        });
        continue;
      }

      if ((upd?.length ?? 0) > 0) updated++;
      else noDbMatch++;
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
      consideredFinal,
      updated,
      skipped: { skippedNoGameId, skippedNotFinal, skippedNoWinner, noDbMatch },
      updateErrors, // ✅ this is what we need to see
      debug: { firstGameKeys: games[0] ? Object.keys(games[0]).slice(0, 50) : [] },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}