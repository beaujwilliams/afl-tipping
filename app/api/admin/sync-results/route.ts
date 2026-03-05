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

// Squiggle score parsing:
// - sometimes number: 70
// - sometimes string: "10.10.70" (goals.behinds.total)
// - sometimes string: "70"
function parseTotalScore(v: any): number | null {
  if (v === null || v === undefined) return null;

  if (typeof v === "number" && Number.isFinite(v)) return v;

  const s = String(v).trim();
  if (!s) return null;

  if (s.includes(".")) {
    const parts = s
      .split(".")
      .map((x) => x.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    const n = Number(last);
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isFinalGame(g: any): boolean {
  if (Number(g?.complete) === 100) return true;

  const hs = parseTotalScore(g?.hscore ?? g?.home_score ?? g?.home_total);
  const as = parseTotalScore(g?.ascore ?? g?.away_score ?? g?.away_total);
  return hs !== null && as !== null;
}

function winnerFromTotals(g: any): { winner: string | null; homeTotal: number | null; awayTotal: number | null } {
  const homeTotal = parseTotalScore(g?.hscore ?? g?.home_score ?? g?.home_total);
  const awayTotal = parseTotalScore(g?.ascore ?? g?.away_score ?? g?.away_total);

  if (homeTotal === null || awayTotal === null) {
    // try explicit winner field if present
    const w = g?.winner ?? g?.winnerteam ?? null;
    return { winner: w ? String(w) : null, homeTotal, awayTotal };
  }

  if (homeTotal > awayTotal) return { winner: g?.hteam ? String(g.hteam) : null, homeTotal, awayTotal };
  if (awayTotal > homeTotal) return { winner: g?.ateam ? String(g.ateam) : null, homeTotal, awayTotal };

  // draw
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

    // Use complete=100 to minimize payload, but still parse robustly.
    const gamesUrl = `https://api.squiggle.com.au/?q=games;year=${season};complete=100;format=json`;
    const resp = await fetch(gamesUrl, { cache: "no-store" });
    const body = await resp.json();

    const games: any[] = Array.isArray(body?.games) ? body.games : [];
    const finalGamesFound = games.length;

    let updated = 0;
    let consideredFinal = 0;

    let skippedNotFinal = 0;
    let skippedNoWinner = 0;
    let noDbMatch = 0;

    for (const g of games) {
      const gameId = g?.id ?? g?.gameid ?? null;
      if (!gameId) continue;

      if (!isFinalGame(g)) {
        skippedNotFinal++;
        continue;
      }

      const { winner, homeTotal, awayTotal } = winnerFromTotals(g);

      // If it's a draw, winner will be null (we still may want to store scores + is_final)
      // But your existing DB likely expects winner_team for scoring, so we skip draws for now.
      if (!winner) {
        skippedNoWinner++;
        continue;
      }

      consideredFinal++;

      const patch: any = {
        winner_team: String(winner),
        is_final: true,
      };

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

      if (updErr) continue;

      if ((upd?.length ?? 0) > 0) {
        updated++;
      } else {
        noDbMatch++;
      }
    }

    return NextResponse.json({
      ok: true,
      season,
      fetchAttempt: { url: gamesUrl, finalGamesFound, finalDataSource: "complete=100" },
      gamesFetched: finalGamesFound,
      consideredFinal,
      updated,
      skipped: { skippedNotFinal, skippedNoWinner, noDbMatch },
      note: "Using complete=100 (final games only); scores parsed from number or 'goals.behinds.total' string.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}