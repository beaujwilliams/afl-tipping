import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function isAdminOrCron(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;
  if (secret && cronSecret && secret === cronSecret) return true;

  const cookieStore = cookies();
  const supabaseAuth = createServerClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { data } = await supabaseAuth.auth.getUser();
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
      return NextResponse.json({ error: "Competition not found", details: compErr?.message }, { status: 500 });
    }

    const competitionId = comp.id as string;

    // Pull final games from Squiggle (complete=100 usually means final)
    // We’ll update matches where we have an external id match.
    const gamesUrl = `https://api.squiggle.com.au/?q=games;year=${season};complete=100;format=json`;
    const resp = await fetch(gamesUrl, { cache: "no-store" });
    const body = await resp.json();

    const games: any[] = Array.isArray(body?.games) ? body.games : [];
    const finalGamesFound = games.length;

    // Build map by Squiggle game id -> winner
    // Squiggle fields vary; common are "id", "hteam", "ateam", "winner", "hscore", "ascore"
    let updated = 0;
    let consideredFinal = 0;

    for (const g of games) {
      const gameId = g?.id ?? g?.gameid ?? null;
      if (!gameId) continue;

      // Try to determine winner team name
      const winner =
        g?.winner ??
        g?.winnerteam ??
        (typeof g?.hscore === "number" && typeof g?.ascore === "number"
          ? g.hscore > g.ascore
            ? g?.hteam
            : g.ascore > g.hscore
              ? g?.ateam
              : null
          : null);

      if (!winner) continue;

      consideredFinal++;

      const patch: any = {
        winner_team: winner,
        is_final: true,
      };

      if (typeof g?.hscore === "number") patch.home_score = g.hscore;
      if (typeof g?.ascore === "number") patch.away_score = g.ascore;

      // Update by external id (match_external_id)
      const { data: upd, error: updErr } = await supabase
        .from("matches")
        .update(patch)
        .eq("competition_id", competitionId)
        .eq("season", season)
        .eq("match_external_id", String(gameId))
        .select("id")
        .limit(1);

      if (!updErr && (upd?.length ?? 0) > 0) updated++;
    }

    return NextResponse.json({
      ok: true,
      season,
      fetchAttempt: {
        url: gamesUrl,
        finalGamesFound,
        finalDataSource: "complete=100",
      },
      gamesFetched: finalGamesFound,
      consideredFinal,
      updated,
      note: "Using complete=100 (final games only)",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}