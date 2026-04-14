import { NextResponse } from "next/server";
import {
  type AdminAnomaly,
  findDueSnapshotRounds,
  findPendingPaymentAttention,
  findRoundsWithDueRecaps,
  findStaleResultRounds,
  shouldSurfaceNextSeasonInterestAttention,
  sortAdminAnomalies,
  type AnomalyMatchRow,
  type AnomalyRoundRow,
} from "@/lib/admin-anomalies";
import {
  automationJobLabel,
  isMissingRelationError,
  summarizeScoringRun,
} from "@/lib/automation-observability";
import {
  ACTIVE_SCORING_FAILURE_ALERT_THRESHOLD_DEFAULT,
  ACTIVE_SCORING_STALE_WARNING_MINUTES_DEFAULT,
  countLeadingFailedRuns,
  readBoundedInt,
} from "@/lib/scoring-automation-alerts";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";
import { NEXT_SEASON } from "@/lib/season-config";
import { createServiceClient } from "@/lib/supabase-server";

type RecapRow = {
  round_number: number;
};

type CompetitionRow = {
  enforce_unpaid_tip_lock: boolean | null;
};

type AutomationFailureRow = {
  id: string;
  job_kind: string;
  run_status: string;
  started_at_utc: string;
  summary: string | null;
};

type ScoringRunRow = {
  id: string;
  job_kind: string;
  scope: string;
  run_status: string;
  sync_updated: number;
  leaderboard_recalc_ran: boolean;
  leaderboard_recalc_ok: boolean | null;
  started_at_utc: string;
  details: unknown;
};

type ScoringRecentActiveRow = {
  id: string;
  job_kind: string;
  scope: string;
  run_status: string;
  sync_updated: number;
  leaderboard_recalc_ran: boolean;
  leaderboard_recalc_ok: boolean | null;
  started_at_utc: string;
  details: unknown;
};

function isRunInFailureWindow(startedAtUtc: string, failureCutoffUtc: string) {
  const startedMs = new Date(startedAtUtc).getTime();
  const cutoffMs = new Date(failureCutoffUtc).getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(cutoffMs)) return false;
  return startedMs >= cutoffMs;
}

function makeFailureHref(jobKind: string, season: number) {
  if (jobKind === "scoring_15m" || jobKind === "scoring_daily_full" || jobKind === "manual") {
    return `/admin/scoring-sync?season=${encodeURIComponent(String(season))}`;
  }
  return `/admin/automation-health?season=${encodeURIComponent(String(season))}`;
}

function dedupeLatestByJobKind<T extends { job_kind: string; started_at_utc: string }>(rows: T[]) {
  const seen = new Set<string>();
  const sorted = [...rows].sort(
    (a, b) => new Date(b.started_at_utc).getTime() - new Date(a.started_at_utc).getTime()
  );

  return sorted.filter((row) => {
    const key = String(row.job_kind);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseLimit(raw: string | null, fallback: number) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(30, Math.trunc(parsed));
}

function parseFailureWindowHours(raw: string | null, fallback: number) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(24 * 14, Math.trunc(parsed));
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const limit = parseLimit(url.searchParams.get("limit"), 12);
    const failureWindowHours = parseFailureWindowHours(
      url.searchParams.get("failure_window_hours"),
      72
    );
    const activeFailureThreshold = readBoundedInt(
      process.env.ACTIVE_SCORING_FAILURE_ALERT_THRESHOLD,
      ACTIVE_SCORING_FAILURE_ALERT_THRESHOLD_DEFAULT,
      2,
      12
    );
    const activeRunStaleMinutes = readBoundedInt(
      process.env.ACTIVE_SCORING_STALE_WARNING_MINUTES,
      ACTIVE_SCORING_STALE_WARNING_MINUTES_DEFAULT,
      10,
      180
    );

    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await resolveCompetitionIdForAdminRequest(req, supabase);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const roundsResult = await supabase
      .from("rounds")
      .select("id, round_number, lock_time_utc, odds_snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (roundsResult.error) {
      return NextResponse.json(
        { error: "Failed to read rounds", details: roundsResult.error.message },
        { status: 500 }
      );
    }

    const rounds = (roundsResult.data ?? []) as AnomalyRoundRow[];
    const roundIds = rounds.map((row) => String(row.id));
    const failureCutoffUtc = new Date(
      Date.now() - failureWindowHours * 60 * 60 * 1000
    ).toISOString();
    const includeNextSeasonInterest = shouldSurfaceNextSeasonInterestAttention({
      targetSeason: NEXT_SEASON,
    });

    const [
      matchesResult,
      competitionResult,
      pendingMembersResult,
      recapResult,
      nextSeasonInterestResult,
      automationRecentResult,
      scoringRecentResult,
      scoringRecentActiveResult,
    ] = await Promise.all([
      roundIds.length > 0
        ? supabase
            .from("matches")
            .select("id, round_id, commence_time_utc, winner_team")
            .in("round_id", roundIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("competitions")
        .select("enforce_unpaid_tip_lock")
        .eq("id", competitionId)
        .maybeSingle(),
      supabase
        .from("memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("competition_id", competitionId)
        .eq("payment_status", "pending"),
      supabase
        .from("round_recaps")
        .select("round_number")
        .eq("competition_id", competitionId)
        .eq("season", season)
        .eq("recap_type", "end_of_round_v1"),
      includeNextSeasonInterest
        ? supabase
            .from("next_season_interest")
            .select("id", { count: "exact", head: true })
            .eq("target_season", NEXT_SEASON)
            .eq("status", "pending")
        : Promise.resolve({ count: 0, error: null }),
      supabase
        .from("automation_job_runs")
        .select("id, job_kind, run_status, started_at_utc, summary")
        .eq("competition_id", competitionId)
        .eq("season", season)
        .order("started_at_utc", { ascending: false })
        .limit(40),
      supabase
        .from("scoring_automation_runs")
        .select(
          "id, job_kind, scope, run_status, sync_updated, leaderboard_recalc_ran, leaderboard_recalc_ok, started_at_utc, details"
        )
        .eq("competition_id", competitionId)
        .eq("season", season)
        .order("started_at_utc", { ascending: false })
        .limit(40),
      supabase
        .from("scoring_automation_runs")
        .select(
          "id, job_kind, scope, run_status, sync_updated, leaderboard_recalc_ran, leaderboard_recalc_ok, started_at_utc, details"
        )
        .eq("competition_id", competitionId)
        .eq("season", season)
        .eq("job_kind", "scoring_15m")
        .order("started_at_utc", { ascending: false })
        .limit(12),
    ]);

    if (matchesResult.error) {
      return NextResponse.json(
        { error: "Failed to read matches", details: matchesResult.error.message },
        { status: 500 }
      );
    }

    if (competitionResult.error) {
      return NextResponse.json(
        { error: "Failed to read competition settings", details: competitionResult.error.message },
        { status: 500 }
      );
    }

    if (pendingMembersResult.error) {
      return NextResponse.json(
        { error: "Failed to read pending member count", details: pendingMembersResult.error.message },
        { status: 500 }
      );
    }

    const sourceHints: Record<string, string | null> = {
      round_recaps: null,
      next_season_interest: null,
      automation_job_runs: null,
      scoring_automation_runs: null,
    };

    const recapRoundNumbers: number[] = [];
    if (recapResult.error) {
      if (isMissingRelationError(recapResult.error.message, "round_recaps")) {
        sourceHints.round_recaps = "Apply migration db/migrations/20260310_round_recaps.sql";
      } else {
        return NextResponse.json(
          { error: "Failed to read round recaps", details: recapResult.error.message },
          { status: 500 }
        );
      }
    } else {
      ((recapResult.data ?? []) as RecapRow[]).forEach((row) => {
        recapRoundNumbers.push(Number(row.round_number ?? 0));
      });
    }

    let nextSeasonPendingCount = 0;
    if (includeNextSeasonInterest && nextSeasonInterestResult.error) {
      if (isMissingRelationError(nextSeasonInterestResult.error.message, "next_season_interest")) {
        sourceHints.next_season_interest =
          "Apply migration db/migrations/20260326_next_season_interest.sql";
      } else {
        return NextResponse.json(
          {
            error: "Failed to read next-season interest count",
            details: nextSeasonInterestResult.error.message,
          },
          { status: 500 }
        );
      }
    } else if (includeNextSeasonInterest) {
      nextSeasonPendingCount = Number(nextSeasonInterestResult.count ?? 0);
    }

    let automationRecent: AutomationFailureRow[] = [];
    if (automationRecentResult.error) {
      if (isMissingRelationError(automationRecentResult.error.message, "automation_job_runs")) {
        sourceHints.automation_job_runs =
          "Apply migration db/migrations/20260407_automation_job_runs.sql";
      } else {
        return NextResponse.json(
          { error: "Failed to read automation runs", details: automationRecentResult.error.message },
          { status: 500 }
        );
      }
    } else {
      automationRecent = (automationRecentResult.data ?? []) as AutomationFailureRow[];
    }

    let scoringRecent: ScoringRunRow[] = [];
    if (scoringRecentResult.error) {
      if (isMissingRelationError(scoringRecentResult.error.message, "scoring_automation_runs")) {
        sourceHints.scoring_automation_runs =
          "Apply migration db/migrations/20260327_scoring_automation_runs.sql";
      } else {
        return NextResponse.json(
          { error: "Failed to read scoring runs", details: scoringRecentResult.error.message },
          { status: 500 }
        );
      }
    } else {
      scoringRecent = (scoringRecentResult.data ?? []) as ScoringRunRow[];
    }

    let scoringRecentActive: ScoringRecentActiveRow[] = [];
    if (scoringRecentActiveResult.error) {
      if (
        isMissingRelationError(scoringRecentActiveResult.error.message, "scoring_automation_runs")
      ) {
        sourceHints.scoring_automation_runs =
          "Apply migration db/migrations/20260327_scoring_automation_runs.sql";
      } else {
        return NextResponse.json(
          {
            error: "Failed to read recent active scoring runs",
            details: scoringRecentActiveResult.error.message,
          },
          { status: 500 }
        );
      }
    } else {
      scoringRecentActive = (scoringRecentActiveResult.data ?? []) as ScoringRecentActiveRow[];
    }

    const anomalies: AdminAnomaly[] = [];

    dedupeLatestByJobKind(scoringRecent)
      .filter(
        (run) =>
          String(run.run_status).toLowerCase() === "failed" &&
          isRunInFailureWindow(run.started_at_utc, failureCutoffUtc)
      )
      .forEach((run) => {
      anomalies.push({
        id: `scoring-failure-${run.id}`,
        severity: "critical",
        category: "automation",
        title: `${automationJobLabel(run.job_kind)} failed`,
        detail: summarizeScoringRun(run),
        href: makeFailureHref(run.job_kind, season),
        cta: "Open scoring log",
      });
      });

    if (scoringRecentActive.length > 0) {
      const consecutiveActiveFailures = countLeadingFailedRuns(scoringRecentActive);
      if (consecutiveActiveFailures >= activeFailureThreshold) {
        const latest = scoringRecentActive[0];
        anomalies.push({
          id: `scoring-active-failure-streak-${latest.id}`,
          severity: "critical",
          category: "automation",
          title: `Active scoring check failing repeatedly (${consecutiveActiveFailures} in a row)`,
          detail: summarizeScoringRun(latest),
          href: `/admin/scoring-sync?season=${encodeURIComponent(String(season))}`,
          cta: "Open scoring log",
        });
      }

      const latestStartedMs = new Date(scoringRecentActive[0].started_at_utc).getTime();
      if (Number.isFinite(latestStartedMs)) {
        const ageMinutes = Math.floor((Date.now() - latestStartedMs) / 60000);
        if (ageMinutes > activeRunStaleMinutes) {
          anomalies.push({
            id: `scoring-active-stale-${scoringRecentActive[0].id}`,
            severity: "warning",
            category: "automation",
            title: "Active scoring checks appear stale",
            detail: `Latest active scoring run was ${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} ago. Cron may not be hitting on schedule.`,
            href: `/admin/scoring-sync?season=${encodeURIComponent(String(season))}`,
            cta: "Open scoring log",
          });
        }
      }
    } else {
      anomalies.push({
        id: `scoring-active-none-${season}`,
        severity: "warning",
        category: "automation",
        title: "No active scoring checks recorded",
        detail: "No scoring_15m runs are logged for this season yet.",
        href: `/admin/scoring-sync?season=${encodeURIComponent(String(season))}`,
        cta: "Open scoring log",
      });
    }

    dedupeLatestByJobKind(automationRecent)
      .filter(
        (run) =>
          String(run.run_status).toLowerCase() === "failed" &&
          isRunInFailureWindow(run.started_at_utc, failureCutoffUtc)
      )
      .forEach((run) => {
      anomalies.push({
        id: `automation-failure-${run.id}`,
        severity: "critical",
        category: "automation",
        title: `${automationJobLabel(run.job_kind)} failed`,
        detail: run.summary?.trim() || "Automation reported a failure.",
        href: makeFailureHref(run.job_kind, season),
        cta: "Open automation health",
      });
      });

    findDueSnapshotRounds({ rounds }).slice(0, 3).forEach((round) => {
      anomalies.push({
        id: `snapshot-due-${round.round_id}`,
        severity: "critical",
        category: "odds",
        title: `Locked odds snapshot overdue for Round ${round.round_number}`,
        detail: "The snapshot window is already open, but the locked odds timestamp is still missing for this round.",
        href: "/admin#admin-maintenance",
        cta: "Open maintenance",
      });
    });

    findStaleResultRounds({
      rounds,
      matches: (matchesResult.data ?? []) as AnomalyMatchRow[],
    })
      .slice(0, 3)
      .forEach((round) => {
        anomalies.push({
          id: `stale-results-${round.round_id}`,
          severity: "warning",
          category: "results",
          title: `Results may be stale for Round ${round.round_number}`,
          detail: `${round.missing_winner_count} of ${round.total_matches} matches are still missing winners long after the round should have finished.`,
          href: `/admin/scoring-sync?season=${encodeURIComponent(String(season))}`,
          cta: "Open scoring log",
        });
      });

    findRoundsWithDueRecaps({
      rounds,
      matches: (matchesResult.data ?? []) as AnomalyMatchRow[],
      recapRoundNumbers,
    })
      .slice(0, 3)
      .forEach((round) => {
        anomalies.push({
          id: `recap-due-${round.round_id}`,
          severity: "warning",
          category: "recaps",
          title: `Round ${round.round_number} recap is due`,
          detail: "All results are complete and the recap window has opened, but no stored recap exists yet.",
          href: "/admin/recaps",
          cta: "Open recap history",
        });
      });

    const pendingPaymentAttention = findPendingPaymentAttention({
      rounds,
      pendingMemberCount: Number(pendingMembersResult.count ?? 0),
      enforceUnpaidTipLock: !!((competitionResult.data as CompetitionRow | null)?.enforce_unpaid_tip_lock),
    });

    if (pendingPaymentAttention) {
      anomalies.push({
        id: `pending-payments-${pendingPaymentAttention.round_id}`,
        severity: "warning",
        category: "payments",
        title: `${pendingPaymentAttention.pending_member_count} pending member${
          pendingPaymentAttention.pending_member_count === 1 ? "" : "s"
        } before Round ${pendingPaymentAttention.round_number} lock`,
        detail: "Unpaid tip lock is enabled, so these members may be blocked from tipping if payment status is not updated in time.",
        href: `/admin/roster/${season}`,
        cta: "Open season roster",
      });
    }

    if (includeNextSeasonInterest && nextSeasonPendingCount > 0) {
      anomalies.push({
        id: `next-season-interest-${NEXT_SEASON}`,
        severity: "info",
        category: "growth",
        title: `${nextSeasonPendingCount} next-season registration${
          nextSeasonPendingCount === 1 ? "" : "s"
        } awaiting review`,
        detail: "There are pending next-season interest entries ready to review or contact.",
        href: "/admin/onboarding",
        cta: "Open onboarding",
      });
    }

    const sorted = sortAdminAnomalies(anomalies).slice(0, limit);

    return NextResponse.json({
      ok: true,
      season,
      competition_id: competitionId,
      anomalies: sorted,
      counts: {
        total: sorted.length,
        critical: sorted.filter((item) => item.severity === "critical").length,
        warning: sorted.filter((item) => item.severity === "warning").length,
        info: sorted.filter((item) => item.severity === "info").length,
      },
      sources: sourceHints,
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
