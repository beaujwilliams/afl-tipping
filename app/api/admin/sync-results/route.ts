import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";
import { createServiceClient } from "@/lib/supabase-server";
import { invalidateLeaderboardSnapshotCache } from "@/lib/leaderboard-snapshot";
import { isFinalMatchStatus, isMatchCompleted } from "@/lib/match-status";
import { invalidateRoundTipStatusCache } from "@/lib/round-tip-status-data";
import { invalidateStatsSeasonBaseCache } from "@/lib/stats-data";
import { fetchSquiggleJson } from "@/lib/squiggle-api";

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
  commence_time_utc: string | null;
  winner_team: string | null;
  status: string | null;
};

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

const SUPABASE_RETRY_ATTEMPTS = 3;
const SUPABASE_RETRY_BASE_DELAY_MS = 350;
const RESULT_SYNC_WINDOW_AFTER_START_MS = 3 * 60 * 60 * 1000;
const RESULT_SYNC_THROTTLE_MS = 10 * 60 * 1000;

function pickGameId(g: SquiggleGame) {
  const id = g?.id ?? g?.game ?? g?.gameid ?? null;
  if (id === null || id === undefined) return null;
  const n = Number(id);
  return Number.isFinite(n) ? String(n) : null;
}

function pickWinner(g: SquiggleGame) {
  const winner = g?.winner ?? g?.winnerteam ?? null;
  if (winner) {
    const normalizedWinner = String(winner).trim();
    const lower = normalizedWinner.toLowerCase();
    if (lower !== "draw" && lower !== "tie") return normalizedWinner;
  }

  const hs = Number(g?.hscore ?? NaN);
  const as = Number(g?.ascore ?? NaN);
  if (Number.isFinite(hs) && Number.isFinite(as)) {
    if (hs > as) return String(g?.hteam ?? "");
    if (as > hs) return String(g?.ateam ?? "");
  }
  return null;
}

function pickGameOutcome(g: SquiggleGame) {
  const winner = pickWinner(g);
  if (winner) {
    return { final: true, winnerTeam: winner };
  }

  const hs = Number(g?.hscore ?? NaN);
  const as = Number(g?.ascore ?? NaN);
  if (Number.isFinite(hs) && Number.isFinite(as) && hs === as) {
    return { final: true, winnerTeam: null };
  }

  return { final: false, winnerTeam: null };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isInResultSyncWindow(match: MatchLookupRow, nowMs: number) {
  const startMs = match.commence_time_utc ? new Date(match.commence_time_utc).getTime() : NaN;
  return !Number.isFinite(startMs) || startMs + RESULT_SYNC_WINDOW_AFTER_START_MS <= nowMs;
}

function uniqueSortedRoundNumbers(roundNumbers: number[]) {
  return Array.from(
    new Set(roundNumbers.filter((round) => Number.isFinite(round)).map((round) => Number(round)))
  ).sort((a, b) => a - b);
}

function buildSquiggleGamesUrls({
  season,
  scope,
  targetRoundNumbers,
}: {
  season: number;
  scope: "active" | "full";
  targetRoundNumbers: number[];
}) {
  const baseUrl = `https://api.squiggle.com.au/?q=games;year=${season}`;
  if (scope === "active") {
    const rounds = uniqueSortedRoundNumbers(targetRoundNumbers);
    if (rounds.length > 0) {
      return rounds.map((round) => `${baseUrl};round=${round};complete=100;format=json`);
    }
  }
  return [`${baseUrl};complete=100;format=json`];
}

function readNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function hasRoundOverlap(left: number[], right: number[]) {
  const rightSet = new Set(right.map((item) => Number(item)));
  return left.some((item) => rightSet.has(Number(item)));
}

function readSyncJsonFromRunDetails(details: unknown) {
  const detailsObj = asRecord(details);
  const syncCall = asRecord(detailsObj?.sync_results);
  return asRecord(syncCall?.json) ?? syncCall;
}

function hasSquiggleFetchAttempt(syncJson: Record<string, unknown>) {
  if (asRecord(syncJson.fetchAttempt)) return true;
  if (!Array.isArray(syncJson.fetchAttempts)) return false;
  return syncJson.fetchAttempts.some((attempt) => Boolean(asRecord(attempt)));
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

async function findRecentActiveResultFetch(params: {
  supabase: ReturnType<typeof createServiceClient>;
  competitionId: string;
  season: number;
  targetRoundNumbers: number[];
  nowMs: number;
}) {
  const cutoffUtc = new Date(params.nowMs - RESULT_SYNC_THROTTLE_MS).toISOString();
  const recentRuns = await withSupabaseRetry(() =>
    params.supabase
      .from("scoring_automation_runs")
      .select("id, started_at_utc, details")
      .eq("competition_id", params.competitionId)
      .eq("season", params.season)
      .eq("job_kind", "scoring_15m")
      .eq("scope", "active")
      .gte("started_at_utc", cutoffUtc)
      .order("started_at_utc", { ascending: false })
      .limit(12)
  );

  if (recentRuns.error) {
    return {
      throttled: false,
      unavailable: true,
      error: recentRuns.error.message,
    };
  }

  for (const row of recentRuns.data ?? []) {
    const syncJson = readSyncJsonFromRunDetails((row as { details?: unknown }).details);
    if (!syncJson || syncJson.scope !== "active") continue;
    if (!hasSquiggleFetchAttempt(syncJson)) continue;

    const roundsTargeted = readNumberArray(syncJson.roundsTargeted);
    if (!hasRoundOverlap(roundsTargeted, params.targetRoundNumbers)) continue;

    const startedAtUtc = String((row as { started_at_utc?: unknown }).started_at_utc ?? "");
    const startedAtMs = new Date(startedAtUtc).getTime();
    if (!Number.isFinite(startedAtMs)) continue;

    const retryAfterMs = Math.max(0, startedAtMs + RESULT_SYNC_THROTTLE_MS - params.nowMs);
    if (retryAfterMs <= 0) continue;

    return {
      throttled: true,
      unavailable: false,
      lastCheckedAtUtc: startedAtUtc,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      roundsTargeted,
    };
  }

  return {
    throttled: false,
    unavailable: false,
    error: null,
  };
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
        .select("id, round_id, squiggle_game_id, commence_time_utc, winner_team, status")
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
        return roundMatches.some((m) => !isMatchCompleted(m) && isInResultSyncWindow(m, nowMs));
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
            ? "No locked unfinished rounds with matches in the result sync window detected. Nothing to sync."
            : "No target rounds detected. Nothing to sync.",
      });
    }

    const targetMatches = matchRows.filter((m) => targetRoundSet.has(String(m.round_id)));

    const throttle =
      scope === "active"
        ? await findRecentActiveResultFetch({
            supabase,
            competitionId: resolvedCompetitionId,
            season,
            targetRoundNumbers,
            nowMs,
          })
        : { throttled: false, unavailable: false, error: null };

    if (throttle.throttled) {
      return respond(200, {
        ok: true,
        season,
        competition_id: resolvedCompetitionId,
        scope,
        roundsTargeted: targetRoundNumbers,
        roundsTargetedCount: targetRoundNumbers.length,
        activeRoundsDetected: roundRows
          .filter((round) => activeRoundIds.includes(String(round.id)))
          .map((round) => Number(round.round_number)),
        targetMatchesCount: targetMatches.length,
        fetchAttempt: null,
        fetchAttempts: [],
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
        throttled: true,
        throttle: {
          windowSeconds: Math.ceil(RESULT_SYNC_THROTTLE_MS / 1000),
          lastCheckedAtUtc: throttle.lastCheckedAtUtc,
          retryAfterSeconds: throttle.retryAfterSeconds,
          roundsTargeted: throttle.roundsTargeted,
        },
        skip_reason: "squiggle_result_throttle",
        note: "Skipped Squiggle result fetch because this active round was checked recently.",
      });
    }

    const targetMatchesByGameId = new Map<string, MatchLookupRow>();
    for (const match of targetMatches) {
      const gameIdNumber = Number(match.squiggle_game_id ?? NaN);
      if (!Number.isFinite(gameIdNumber)) continue;
      targetMatchesByGameId.set(String(gameIdNumber), match);
    }

    const gamesUrls = buildSquiggleGamesUrls({ season, scope, targetRoundNumbers });
    const games: SquiggleGame[] = [];
    const fetchAttempts: Array<Record<string, unknown>> = [];
    const finalDataSource =
      scope === "active" ? "round-filtered complete=100" : "season complete=100";

    for (const gamesUrl of gamesUrls) {
      const squiggleResult = await fetchSquiggleJson(gamesUrl);
      const body = asRecord(squiggleResult.json);
      const fetchedGames = Array.isArray(body?.games) ? (body.games as SquiggleGame[]) : [];
      const attempt: Record<string, unknown> = {
        url: gamesUrl,
        httpStatus: squiggleResult.response.status,
        httpOk: squiggleResult.response.ok,
        rawGamesCount: fetchedGames.length,
        finalGamesFound: fetchedGames.length,
        finalDataSource,
        userAgent: squiggleResult.userAgent,
      };

      if (squiggleResult.parseError) {
        attempt.parseError = squiggleResult.parseError;
      }

      fetchAttempts.push(attempt);

      if (!squiggleResult.response.ok) {
        attempt.responseHead = squiggleResult.textHead;
        return respond(502, {
          ok: false,
          season,
          competition_id: resolvedCompetitionId,
          scope,
          roundsTargeted: targetRoundNumbers,
          roundsTargetedCount: targetRoundNumbers.length,
          error: `Squiggle request failed with HTTP ${squiggleResult.response.status}.`,
          fetchAttempt: attempt,
          fetchAttempts,
        });
      }

      if (squiggleResult.parseError || !body) {
        attempt.responseHead = squiggleResult.textHead;
        return respond(502, {
          ok: false,
          season,
          competition_id: resolvedCompetitionId,
          scope,
          roundsTargeted: targetRoundNumbers,
          roundsTargetedCount: targetRoundNumbers.length,
          error: "Squiggle returned a non-JSON or malformed response.",
          fetchAttempt: attempt,
          fetchAttempts,
        });
      }

      if (body.error || body.warning) {
        return respond(502, {
          ok: false,
          season,
          competition_id: resolvedCompetitionId,
          scope,
          roundsTargeted: targetRoundNumbers,
          roundsTargetedCount: targetRoundNumbers.length,
          error: "Squiggle returned an error/warning payload instead of game data.",
          fetchAttempt: attempt,
          fetchAttempts,
          debug: {
            error: body.error ?? null,
            warning: body.warning ?? null,
          },
        });
      }

      if (!Array.isArray(body.games)) {
        return respond(502, {
          ok: false,
          season,
          competition_id: resolvedCompetitionId,
          scope,
          roundsTargeted: targetRoundNumbers,
          roundsTargetedCount: targetRoundNumbers.length,
          error: "Squiggle response did not include a games array.",
          fetchAttempt: attempt,
          fetchAttempts,
          debug: {
            responseKeys: Object.keys(body),
          },
        });
      }

      games.push(...fetchedGames);
    }

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

    if (first && (first.error || first.warning) && finalGamesFound === 1 && !firstGameIdGuess) {
      return respond(502, {
        ok: false,
        season,
        error: "Squiggle returned an error/warning payload instead of a game row.",
        fetchAttempt: fetchAttempts[0] ?? null,
        fetchAttempts,
        debug: {
          firstGameKeys,
          firstGameSample: first,
        },
      });
    }

    for (const g of finals) {
      if (g && (g.error || g.warning) && !pickGameId(g)) {
        skipped.skippedApiErrorRow++;
        continue;
      }

      const gameId = pickGameId(g);
      if (!gameId) {
        skipped.skippedNoGameId++;
        continue;
      }

      const outcome = pickGameOutcome(g);
      if (!outcome.final) {
        skipped.skippedNoWinner++;
        continue;
      }

      const match = targetMatchesByGameId.get(gameId) ?? null;
      if (!match?.id) {
        skipped.noDbMatch++;
        continue;
      }

      consideredFinal++;

      const existingWinner = String(match.winner_team ?? "").trim() || null;
      const existingFinal = isFinalMatchStatus(match.status);
      if (existingWinner === outcome.winnerTeam && existingFinal) {
        skipped.alreadySet++;
        continue;
      }

      const { error: updErr } = await withSupabaseRetry(() =>
        supabase
          .from("matches")
          .update({ winner_team: outcome.winnerTeam, status: "final" })
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
        invalidateStatsSeasonBaseCache();
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
      fetchAttempt: fetchAttempts[0] ?? null,
      fetchAttempts,
      rawGamesCount,
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
          ? "Active scope: locked + unfinished rounds with matches in the result sync window only. Recalc should run only when updated > 0."
          : "Full scope: all rounds in season for this competition.",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
