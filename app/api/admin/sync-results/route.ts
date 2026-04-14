import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";
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
  round_id: string;
  squiggle_game_id: number | null;
  winner_team: string | null;
};

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

const SUPABASE_RETRY_ATTEMPTS = 3;
const SUPABASE_RETRY_BASE_DELAY_MS = 350;

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function isRetryableSupabaseMessage(message: string) {
  const m = String(message ?? "").toLowerCase();
  if (!m) return false;
  return (
    m.includes("502") ||
    m.includes("bad gateway") ||
    m.includes("cloudflare") ||
    m.includes("gateway") ||
    m.includes("fetch failed") ||
    m.includes("network") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("temporarily unavailable")
  );
}

function readErrorFromResult(result: unknown): { message: string } | null {
  if (!result || typeof result !== "object") return null;
  const obj = result as { error?: unknown };
  if (!obj.error || typeof obj.error !== "object") return null;
  const errObj = obj.error as { message?: unknown };
  const message = typeof errObj.message === "string" ? errObj.message : "";
  if (!message) return null;
  return { message };
}

async function withSupabaseRetry<T>(fn: () => PromiseLike<T> | T): Promise<T> {
  for (let attempt = 1; attempt <= SUPABASE_RETRY_ATTEMPTS; attempt += 1) {
    const result = await fn();
    const err = readErrorFromResult(result);
    if (!err) return result;
    const shouldRetry =
      isRetryableSupabaseMessage(err.message) && attempt < SUPABASE_RETRY_ATTEMPTS;
    if (!shouldRetry) return result;
    const delayMs = SUPABASE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    await sleep(delayMs);
  }
  return await fn();
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json({ ok: false, ...gate.json }, { status: gate.status });
    const actorMode = gate.mode;
    const actorUserId = gate.mode === "bearer" ? gate.userId : null;

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const scopeParam = String(url.searchParams.get("scope") ?? "").trim().toLowerCase();
    const forceFull = url.searchParams.get("force_full") === "1";
    const scope = forceFull ? "full" : scopeParam === "active" ? "active" : "full";

    const supabase = createServiceClient();
    const competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await resolveCompetitionIdForAdminRequest(req, supabase);

    if (!competitionId) {
      return NextResponse.json(
        { ok: false, season, error: "No competition found" },
        { status: 404 }
      );
    }
    const resolvedCompetitionId = competitionId;

    async function respond(status: number, body: Record<string, unknown>) {
      let resultStatus: "success" | "skipped" | "failed" = "success";
      let summary = `Results sync finished for season ${season}.`;

      if (body.ok !== true) {
        resultStatus = "failed";
        summary = String(body.error ?? "Results sync failed.");
      } else {
        const updatedCount = Number(body.updated ?? 0);
        const roundsTargeted = Array.isArray(body.roundsTargeted)
          ? body.roundsTargeted.filter((value) => Number.isFinite(Number(value)))
          : [];
        const roundsLabel = roundsTargeted.length > 0 ? roundsTargeted.join(", ") : "none";

        if (Number.isFinite(updatedCount) && updatedCount > 0) {
          summary = `Synced results for season ${season}: updated ${updatedCount} match${updatedCount === 1 ? "" : "es"} across round(s) ${roundsLabel}.`;
        } else {
          resultStatus = "skipped";
          summary =
            typeof body.note === "string" && body.note.trim()
              ? body.note
              : `Checked results for season ${season}: no match updates were needed.`;
        }
      }

      const auditError = await recordAdminAuditEvent({
        competitionId: resolvedCompetitionId,
        season,
        actionType: "sync_results",
        resultStatus,
        actorMode,
        actorUserId,
        targetType: "season",
        targetLabel: `Season ${season}`,
        summary,
        requestPath: url.pathname + url.search,
        details: body,
      });
      if (auditError) {
        console.warn("admin audit log failed after sync-results", auditError);
      }

      return NextResponse.json(body, { status });
    }

    const roundsQuery = await withSupabaseRetry(() =>
      supabase
        .from("rounds")
        .select("id, round_number, lock_time_utc")
        .eq("competition_id", competitionId)
        .eq("season", season)
        .order("round_number", { ascending: true })
    );

    if (roundsQuery.error) {
      return respond(500,
        { ok: false, season, error: "Failed to load rounds", details: roundsQuery.error.message },
      );
    }

    const roundRows = (roundsQuery.data ?? []) as RoundRow[];
    const roundIds = roundRows.map((r) => String(r.id));

    if (roundIds.length === 0) {
      return respond(200, {
        ok: true,
        season,
        competition_id: resolvedCompetitionId,
        scope,
        roundsTargeted: [],
        roundsTargetedCount: 0,
        fetchAttempt: null,
        gamesFetched: 0,
        consideredFinal: 0,
        updated: 0,
        skipped: {
          skippedNoGameId: 0,
          skippedNoWinner: 0,
          noDbMatch: 0,
          alreadySet: 0,
          skippedApiErrorRow: 0,
        },
        updateErrors: [],
        note: "No rounds found for this season and competition.",
      });
    }

    const matchesQuery = await withSupabaseRetry(() =>
      supabase
        .from("matches")
        .select("id, round_id, squiggle_game_id, winner_team")
        .in("round_id", roundIds)
    );

    if (matchesQuery.error) {
      return respond(500,
        { ok: false, season, error: "Failed to load matches", details: matchesQuery.error.message },
      );
    }

    const matchRows = (matchesQuery.data ?? []) as MatchLookupRow[];
    const matchesByRoundId = new Map<string, MatchLookupRow[]>();
    for (const match of matchRows) {
      const roundId = String(match.round_id);
      const list = matchesByRoundId.get(roundId) ?? [];
      list.push(match);
      matchesByRoundId.set(roundId, list);
    }

    const nowMs = Date.now();
    const activeRoundIds = roundRows
      .filter((round) => {
        const lockMs = round.lock_time_utc ? new Date(round.lock_time_utc).getTime() : NaN;
        if (!Number.isFinite(lockMs) || lockMs > nowMs) return false;
        const roundMatches = matchesByRoundId.get(String(round.id)) ?? [];
        return roundMatches.some((m) => !String(m.winner_team ?? "").trim());
      })
      .map((round) => String(round.id));

    const targetRoundIds = scope === "active" ? activeRoundIds : roundIds;
    const targetRoundSet = new Set<string>(targetRoundIds);
    const targetRoundNumbers = roundRows
      .filter((round) => targetRoundSet.has(String(round.id)))
      .map((round) => Number(round.round_number));

    if (targetRoundIds.length === 0) {
      return respond(200, {
        ok: true,
        season,
        competition_id: resolvedCompetitionId,
        scope,
        roundsTargeted: [],
        roundsTargetedCount: 0,
        activeRoundsDetected: roundRows
          .filter((round) => activeRoundIds.includes(String(round.id)))
          .map((round) => Number(round.round_number)),
        fetchAttempt: null,
        gamesFetched: 0,
        consideredFinal: 0,
        updated: 0,
        skipped: {
          skippedNoGameId: 0,
          skippedNoWinner: 0,
          noDbMatch: 0,
          alreadySet: 0,
          skippedApiErrorRow: 0,
        },
        updateErrors: [],
        note:
          scope === "active"
            ? "No locked unfinished rounds detected. Nothing to sync."
            : "No target rounds detected. Nothing to sync.",
      });
    }

    const targetMatchesByGameId = new Map<string, MatchLookupRow>();
    const targetMatches = matchRows.filter((m) => targetRoundSet.has(String(m.round_id)));
    for (const match of targetMatches) {
      const gameIdNumber = Number(match.squiggle_game_id ?? NaN);
      if (!Number.isFinite(gameIdNumber)) continue;
      targetMatchesByGameId.set(String(gameIdNumber), match);
    }

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
      return respond(502, {
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
      });
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

      const match = targetMatchesByGameId.get(gameId) ?? null;
      if (!match?.id) {
        skipped.noDbMatch++;
        continue;
      }

      consideredFinal++;

      if (String(match.winner_team ?? "") === winner) {
        skipped.alreadySet++;
        continue;
      }

      const { error: updErr } = await withSupabaseRetry(() =>
        supabase
          .from("matches")
          .update({ winner_team: winner, status: "final" })
          .eq("id", match.id)
      );

      if (updErr) {
        updateErrors.push({ gameId, step: "update", message: updErr.message, code: updErr.code });
        continue;
      }

      updated++;
    }

    if (updated > 0) {
      try {
        await invalidateRoundTipStatusCache({
          competitionId: resolvedCompetitionId,
          season,
          supabase,
        });
        await invalidateLeaderboardSnapshotCache({
          competitionId: resolvedCompetitionId,
          season,
          supabase,
        });
      } catch (cacheErr) {
        console.warn("cache invalidation failed after sync-results", cacheErr);
      }
    }

    return respond(200, {
      ok: true,
      season,
      competition_id: competitionId,
      scope,
      roundsTargeted: targetRoundNumbers,
      roundsTargetedCount: targetRoundNumbers.length,
      activeRoundsDetected: roundRows
        .filter((round) => activeRoundIds.includes(String(round.id)))
        .map((round) => Number(round.round_number)),
      targetMatchesCount: targetMatches.length,
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
      note:
        scope === "active"
          ? "Active scope: locked + unfinished rounds only. Recalc should run only when updated > 0."
          : "Full scope: all rounds in season for this competition.",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
