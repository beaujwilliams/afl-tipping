import { NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/admin-auth";
import { createServiceClient } from "@/lib/supabase-server";
import { invalidateLeaderboardSnapshotCache } from "@/lib/leaderboard-snapshot";
import { invalidateRoundTipStatusCache } from "@/lib/round-tip-status-data";

type SquiggleGame = {
  id?: number | string | null;
  game?: number | string | null;
  gameid?: number | string | null;
  winner?: string | null;
  winnerteam?: string | null;
  hscore?: number | string | null;
  ascore?: number | string | null;
  hteam?: string | null;
  ateam?: string | null;
  error?: unknown;
  warning?: unknown;
};

type MatchLookupRow = {
  id: string;
  winner_team: string | null;
};

type RoundCompetitionRow = {
  competition_id: string;
};

function pickGameId(g: SquiggleGame) {
  const id = g?.id ?? g?.game ?? g?.gameid ?? null;
  if (id === null || id === undefined) return null;
  const n = Number(id);
  return Number.isFinite(n) ? String(n) : null;
}

function pickWinner(g: SquiggleGame) {
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
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json({ ok: false, ...gate.json }, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");

    const supabase = createServiceClient();

    const gamesUrl = `https://api.squiggle.com.au/?q=games;year=${season};complete=100;format=json`;

    // ✅ headers reduce “warning/error object” responses
    const resp = await fetch(gamesUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "afl-tipping/1.0 (results-sync)",
      },
    });

    const body = await resp.json().catch(() => null);
    const games: SquiggleGame[] = Array.isArray(body?.games) ? (body.games as SquiggleGame[]) : [];
    const rawGamesCount = games.length;

    const finals = games; // complete=100 already filters
    const finalGamesFound = finals.length;

    let consideredFinal = 0;
    let updated = 0;

    const skipped = {
      skippedNoGameId: 0,
      skippedNoWinner: 0,
      noDbMatch: 0,
      alreadySet: 0,
      skippedApiErrorRow: 0,
    };

    const updateErrors: Array<{ gameId: string | null; step: string; message: string; code?: string }> = [];

    const first = finals[0] ?? null;
    const firstGameKeys = first && typeof first === "object" ? Object.keys(first) : [];
    const firstGameIdGuess = first ? pickGameId(first) : null;

    // ✅ If Squiggle returned an error/warning row in games[], surface it clearly
    if (first && (first.error || first.warning) && finalGamesFound === 1 && !firstGameIdGuess) {
      return NextResponse.json({
        ok: false,
        season,
        error: "Squiggle returned an error/warning payload instead of a game row.",
        fetchAttempt: {
          url: gamesUrl,
          httpStatus: resp.status,
          rawGamesCount,
          finalGamesFound,
          finalDataSource: "complete=100",
        },
        debug: {
          firstGameKeys,
          firstGameSample: first,
        },
      }, { status: 502 });
    }

    for (const g of finals) {
      // skip “api payload rows” defensively
      if (g && (g.error || g.warning) && !pickGameId(g)) {
        skipped.skippedApiErrorRow++;
        continue;
      }

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

      const { data: matchRow, error: findErr } = await supabase
        .from("matches")
        .select("id, winner_team")
        .eq("squiggle_game_id", Number(gameId))
        .maybeSingle();

      if (findErr) {
        updateErrors.push({ gameId, step: "find", message: findErr.message, code: findErr.code });
        continue;
      }

      const match = (matchRow as MatchLookupRow | null) ?? null;
      if (!match?.id) {
        skipped.noDbMatch++;
        continue;
      }

      if (String(match.winner_team ?? "") === winner) {
        skipped.alreadySet++;
        continue;
      }

      const { error: updErr } = await supabase
        .from("matches")
        .update({ winner_team: winner, status: "final" })
        .eq("id", match.id);

      if (updErr) {
        updateErrors.push({ gameId, step: "update", message: updErr.message, code: updErr.code });
        continue;
      }

      updated++;
    }

    if (updated > 0) {
      const { data: rounds } = await supabase
        .from("rounds")
        .select("competition_id")
        .eq("season", season);

      const competitionIds = Array.from(
        new Set((rounds ?? []).map((row) => String((row as RoundCompetitionRow).competition_id)))
      );

      await Promise.all(
        competitionIds.map(async (competitionId) => {
          try {
            await invalidateRoundTipStatusCache({
              competitionId,
              season,
              supabase,
            });
            await invalidateLeaderboardSnapshotCache({
              competitionId,
              season,
              supabase,
            });
          } catch (cacheErr) {
            console.warn("cache invalidation failed after sync-results", cacheErr);
          }
        })
      );
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
      debug: {
        firstGameKeys,
        firstGameIdGuess,
      },
      note: "Uses complete=100 so all returned games are treated as finals. Uses matches.squiggle_game_id to find matches.",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
