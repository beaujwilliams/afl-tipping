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

function pickGameId(g: any) {
  const id = g?.id ?? g?.game ?? g?.gameid ?? null;
  if (id === null || id === undefined) return null;
  const n = Number(id);
  return Number.isFinite(n) ? String(n) : null;
}

function pickWinner(g: any) {
  const winner = g?.winner ?? g?.winnerteam ?? null;
  if (winner) return String(winner);

  const hs = Number(g?.hscore ?? NaN);
  const as = Number(g?.ascore ?? NaN);
  if (Number.isFinite(hs) && Number.isFinite(as)) {
    if (hs > as) return String(g?.hteam ?? "");
    if (as > hs) return String(g?.ateam ?? "");
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const allowed = await isAdminOrCron(req);
    if (!allowed) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");

    const supabase = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const gamesUrl = `https://api.squiggle.com.au/?q=games;year=${season};complete=100;format=json`;
    const resp = await fetch(gamesUrl, { cache: "no-store" });
    const body = await resp.json();

    const games: any[] = Array.isArray(body?.games) ? body.games : [];
    const rawGamesCount = games.length;

    // ✅ complete=100 already means “final games” — don’t filter again.
    const finals = games;
    const finalGamesFound = finals.length;

    let consideredFinal = 0;
    let updated = 0;

    const skipped = {
      skippedNoGameId: 0,
      skippedNoWinner: 0,
      noDbMatch: 0,
      alreadySet: 0,
    };

    const updateErrors: Array<{ gameId: string | null; step: string; message: string; code?: string }> = [];

    for (const g of finals) {
      const gameId = pickGameId(g);
      if (!gameId) {
        skipped.skippedNoGameId++;
        continue;
      }

      const winner = pickWinner(g);
      if (!winner) {
        skipped.skippedNoWinner++;
        continue;
      }

      consideredFinal++;

      // Find the match by squiggle_game_id (must be stored during fixture sync)
      const { data: matchRow, error: findErr } = await supabase
        .from("matches")
        .select("id, winner_team")
        .eq("squiggle_game_id", Number(gameId))
        .maybeSingle();

      if (findErr) {
        updateErrors.push({ gameId, step: "find", message: findErr.message, code: (findErr as any).code });
        continue;
      }

      if (!matchRow?.id) {
        skipped.noDbMatch++;
        continue;
      }

      // avoid pointless writes (cheaper)
      if (String(matchRow.winner_team ?? "") === winner) {
        skipped.alreadySet++;
        continue;
      }

      const { error: updErr } = await supabase
        .from("matches")
        .update({ winner_team: winner, status: "final" })
        .eq("id", matchRow.id);

      if (updErr) {
        updateErrors.push({ gameId, step: "update", message: updErr.message, code: (updErr as any).code });
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
        rawGamesCount,
        finalGamesFound,
        finalDataSource: "complete=100",
      },
      gamesFetched: finalGamesFound,
      consideredFinal,
      updated,
      skipped,
      updateErrors,
      note: "Uses complete=100 so all returned games are treated as finals. Uses matches.squiggle_game_id to find matches.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}