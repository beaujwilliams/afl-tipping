import { NextResponse } from "next/server";
import { invalidateStatsSeasonBaseCache } from "@/lib/stats-data";
import { refreshLeaderboardSnapshot } from "@/lib/leaderboard-snapshot";
import { isRoundLocked } from "@/lib/scoring-lock-rules";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";
import { recordAdminAuditEvent, shortUserLabel } from "@/lib/admin-audit";
import { invalidateRoundTipStatusCache } from "@/lib/round-tip-status-data";
import { createServiceClient } from "@/lib/supabase-server";

type LateTipRequestBody = {
  season?: number;
  round?: number;
  competition_id?: string;
  target_user_id?: string;
  target_display_name?: string;
  picks?: string[];
  late_submitted_at_utc?: string;
  trigger_leaderboard_recalc?: boolean;
};

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

type MatchRow = {
  id: string;
  home_team: string;
  away_team: string;
};

type TipRow = {
  match_id: string;
  picked_team: string | null;
};

type ProfileLookupRow = {
  id: string;
  display_name: string | null;
};

type Assignment = {
  match: MatchRow;
  pickedTeam: string;
};

function normalizeTeamKey(value: string) {
  return String(value).trim().toLowerCase();
}

function normalizeIsoTimestamp(input: string | null | undefined) {
  const raw = String(input ?? "").trim();
  if (!raw) return new Date().toISOString();
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function buildMatchLabel(match: MatchRow) {
  return `${match.home_team} vs ${match.away_team}`;
}

async function resolveTargetUser(params: {
  supabase: ReturnType<typeof createServiceClient>;
  targetUserId: string | null;
  targetDisplayName: string | null;
}) {
  if (params.targetUserId) {
    const profile = await params.supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", params.targetUserId)
      .maybeSingle();

    if (profile.error || !profile.data) {
      return { error: "Target user not found." } as const;
    }

    const row = profile.data as ProfileLookupRow;
    return {
      userId: String(row.id),
      displayName: String(row.display_name ?? "").trim() || null,
    } as const;
  }

  if (params.targetDisplayName) {
    const rows = await params.supabase
      .from("profiles")
      .select("id, display_name")
      .ilike("display_name", params.targetDisplayName);

    if (rows.error) {
      return { error: rows.error.message } as const;
    }

    const matches = ((rows.data ?? []) as ProfileLookupRow[]).filter((row) =>
      String(row.display_name ?? "").trim().length > 0
    );

    if (matches.length === 0) {
      return {
        error: `No profile found for display name '${params.targetDisplayName}'.`,
      } as const;
    }

    if (matches.length > 1) {
      return {
        error: `Display name '${params.targetDisplayName}' matched multiple users. Provide target_user_id instead.`,
      } as const;
    }

    return {
      userId: String(matches[0].id),
      displayName: String(matches[0].display_name ?? "").trim() || null,
    } as const;
  }

  return {
    error: "Provide target_user_id or target_display_name.",
  } as const;
}

function buildAssignments(params: { matches: MatchRow[]; picks: string[] }) {
  const byTeam = new Map<string, MatchRow>();
  params.matches.forEach((match) => {
    byTeam.set(normalizeTeamKey(match.home_team), match);
    byTeam.set(normalizeTeamKey(match.away_team), match);
  });

  const assignments: Assignment[] = [];
  const assignedMatchIds = new Set<string>();

  for (const pickedTeam of params.picks) {
    const match = byTeam.get(normalizeTeamKey(pickedTeam));
    if (!match) {
      return {
        error: `Team '${pickedTeam}' is not part of this round.`,
      } as const;
    }

    if (assignedMatchIds.has(match.id)) {
      return {
        error: `Multiple picks mapped to the same match (${buildMatchLabel(match)}).`,
      } as const;
    }

    assignments.push({ match, pickedTeam });
    assignedMatchIds.add(match.id);
  }

  return { assignments } as const;
}

export async function POST(req: Request) {
  try {
    const supabase = createServiceClient();
    const body = (await req.json().catch(() => null)) as LateTipRequestBody | null;

    const season = Number(body?.season);
    const round = Number(body?.round);
    if (!Number.isFinite(season) || !Number.isFinite(round) || round < 0) {
      return NextResponse.json(
        { error: "Provide valid season and round." },
        { status: 400 }
      );
    }

    const picks = Array.isArray(body?.picks)
      ? body?.picks
          .map((pick) => String(pick ?? "").trim())
          .filter((pick) => pick.length > 0)
      : [];
    if (!picks.length) {
      return NextResponse.json(
        { error: "Provide at least one team in picks." },
        { status: 400 }
      );
    }

    const lateSubmittedAtUtc = normalizeIsoTimestamp(body?.late_submitted_at_utc);
    if (!lateSubmittedAtUtc) {
      return NextResponse.json(
        { error: "late_submitted_at_utc must be a valid timestamp." },
        { status: 400 }
      );
    }

    const competitionId =
      (body?.competition_id ? String(body.competition_id).trim() : "") ||
      (await resolveCompetitionIdForAdminRequest(req, supabase));
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found." }, { status: 404 });
    }

    const admin = await requireAdminOrCron(req, { competitionId });
    if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });
    const actorUserId = admin.mode === "bearer" ? admin.userId : null;

    const resolvedTarget = await resolveTargetUser({
      supabase,
      targetUserId: String(body?.target_user_id ?? "").trim() || null,
      targetDisplayName: String(body?.target_display_name ?? "").trim() || null,
    });
    if ("error" in resolvedTarget) {
      return NextResponse.json({ error: resolvedTarget.error }, { status: 400 });
    }

    const membership = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", competitionId)
      .eq("user_id", resolvedTarget.userId)
      .maybeSingle();
    if (membership.error || !membership.data) {
      return NextResponse.json(
        { error: "Target user is not a member of this competition." },
        { status: 403 }
      );
    }

    const roundQuery = await supabase
      .from("rounds")
      .select("id, round_number, lock_time_utc")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .eq("round_number", round)
      .single();
    if (roundQuery.error || !roundQuery.data) {
      return NextResponse.json({ error: "Round not found." }, { status: 404 });
    }

    const roundRow = roundQuery.data as RoundRow;
    if (!isRoundLocked(roundRow.lock_time_utc)) {
      return NextResponse.json(
        {
          error: "Round is not locked. Use the normal tip submission flow.",
          lock_time_utc: roundRow.lock_time_utc,
        },
        { status: 400 }
      );
    }

    const matchesQuery = await supabase
      .from("matches")
      .select("id, home_team, away_team")
      .eq("round_id", roundRow.id);
    if (matchesQuery.error) {
      return NextResponse.json(
        { error: "Failed to load round matches.", details: matchesQuery.error.message },
        { status: 500 }
      );
    }
    const matches = ((matchesQuery.data ?? []) as MatchRow[]) ?? [];
    if (!matches.length) {
      return NextResponse.json({ error: "Round has no matches." }, { status: 400 });
    }

    const assignmentResult = buildAssignments({ matches, picks });
    if ("error" in assignmentResult) {
      return NextResponse.json({ error: assignmentResult.error }, { status: 400 });
    }

    const assignments = assignmentResult.assignments;
    const matchIds = assignments.map((entry) => entry.match.id);
    const existingTips = await supabase
      .from("tips")
      .select("match_id, picked_team")
      .eq("competition_id", competitionId)
      .eq("user_id", resolvedTarget.userId)
      .in("match_id", matchIds);
    if (existingTips.error) {
      return NextResponse.json(
        { error: "Failed to load existing tips.", details: existingTips.error.message },
        { status: 500 }
      );
    }

    const beforeByMatchId = new Map<string, TipRow>();
    ((existingTips.data ?? []) as TipRow[]).forEach((row) => {
      beforeByMatchId.set(String(row.match_id), row);
    });

    const upsertPayload = assignments.map((entry) => ({
      competition_id: competitionId,
      user_id: resolvedTarget.userId,
      match_id: entry.match.id,
      picked_team: entry.pickedTeam,
      updated_at: lateSubmittedAtUtc,
    }));

    const upsert = await supabase.from("tips").upsert(upsertPayload, {
      onConflict: "match_id,user_id",
    });
    if (upsert.error) {
      return NextResponse.json(
        { error: "Failed to save late tips.", details: upsert.error.message },
        { status: 500 }
      );
    }

    const cacheDelete = await supabase
      .from("round_locked_tips_cache")
      .delete({ count: "exact" })
      .eq("competition_id", competitionId)
      .eq("round_id", roundRow.id);

    if (cacheDelete.error) {
      return NextResponse.json(
        {
          error: "Late tips saved but failed to invalidate locked-tip cache.",
          details: cacheDelete.error.message,
        },
        { status: 500 }
      );
    }

    let roundTipStatusCacheWarning: string | null = null;
    try {
      await invalidateRoundTipStatusCache({ competitionId, season, supabase });
    } catch (error: unknown) {
      roundTipStatusCacheWarning =
        error instanceof Error ? error.message : String(error);
    }

    const shouldRecalcLeaderboard = body?.trigger_leaderboard_recalc !== false;
    let leaderboardRecalc:
      | {
          ok: true;
          rows_updated: number;
          matches_scored: number;
          latest_scored_round: number | null;
        }
      | {
          ok: false;
          error: string;
        }
      | null = null;

    if (shouldRecalcLeaderboard) {
      try {
        const snapshot = await refreshLeaderboardSnapshot({
          season,
          competitionId,
          supabase,
        });
        invalidateStatsSeasonBaseCache();
        leaderboardRecalc = {
          ok: true,
          rows_updated: snapshot.rows.length,
          matches_scored: snapshot.matches_scored,
          latest_scored_round: snapshot.latest_scored_round,
        };
      } catch (error: unknown) {
        leaderboardRecalc = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const targetLabel =
      resolvedTarget.displayName ?? shortUserLabel(resolvedTarget.userId);

    const changeSummary = assignments.map((entry) => {
      const before = beforeByMatchId.get(entry.match.id)?.picked_team ?? null;
      return {
        match_id: entry.match.id,
        match: buildMatchLabel(entry.match),
        before_pick: before,
        after_pick: entry.pickedTeam,
      };
    });

    const requestUrl = new URL(req.url);
    const auditError = await recordAdminAuditEvent({
      competitionId,
      season,
      actionType: "late_tip_override",
      actorMode: admin.mode,
      actorUserId,
      targetType: "member",
      targetUserId: resolvedTarget.userId,
      targetLabel,
      summary: `Applied ${assignments.length} late tip override${assignments.length === 1 ? "" : "s"} for ${targetLabel} in season ${season}, round ${round}.`,
      requestPath: requestUrl.pathname + requestUrl.search,
      details: {
        season,
        round,
        round_id: roundRow.id,
        lock_time_utc: roundRow.lock_time_utc,
        late_submitted_at_utc: lateSubmittedAtUtc,
        picks: changeSummary,
        round_locked_tip_cache_rows_deleted: Number(cacheDelete.count ?? 0),
        round_tip_status_cache_warning: roundTipStatusCacheWarning,
        leaderboard_recalc: leaderboardRecalc,
      },
    });

    return NextResponse.json({
      ok: true,
      season,
      round,
      competition_id: competitionId,
      target_user_id: resolvedTarget.userId,
      target_display_name: resolvedTarget.displayName,
      late_submitted_at_utc: lateSubmittedAtUtc,
      saved: assignments.length,
      picks: changeSummary,
      round_locked_tip_cache_rows_deleted: Number(cacheDelete.count ?? 0),
      round_tip_status_cache_warning: roundTipStatusCacheWarning,
      leaderboard_recalc: leaderboardRecalc,
      audit_warning: auditError,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "Unexpected error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
