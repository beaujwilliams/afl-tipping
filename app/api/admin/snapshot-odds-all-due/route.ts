import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import {
  classifySnapshotRun,
  recordAutomationJobRun,
} from "@/lib/automation-observability";
import { isSameInstant } from "@/lib/snapshot-time";

// ✅ Must match snapshot-odds/route.ts
const SNAPSHOT_HOURS_BEFORE_LOCK = 36;

/**
 * Due time = lock_time_utc - 36 hours
 */
function computeSnapshotDueTimeUtc(lockTimeUtcIso: string): string {
  const lockMs = new Date(lockTimeUtcIso).getTime();
  if (Number.isNaN(lockMs)) throw new Error("Invalid lock_time_utc");

  const dueMs = lockMs - SNAPSHOT_HOURS_BEFORE_LOCK * 60 * 60 * 1000;
  return new Date(dueMs).toISOString();
}

type RoundRow = {
  round_number: number;
  lock_time_utc: string;
  odds_snapshot_for_time_utc: string | null;
};

export async function GET(req: Request) {
  const startedAtUtc = new Date().toISOString();
  let logContext:
    | {
        competitionId: string;
        season: number;
        triggerMode: "cron" | "bearer";
        requestPath: string;
      }
    | null = null;
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });
    const triggerMode = gate.mode;
    const cronSecret = gate.mode === "cron" ? gate.secret : null;
    const bearerToken = gate.mode === "bearer" ? gate.token : null;
    const actorUserId = gate.mode === "bearer" ? gate.userId : null;

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || "2026");
    const force = url.searchParams.get("force") === "1";
    const onlyRoundParam = url.searchParams.get("round"); // optional
    const requestPath = url.pathname + url.search;

    const supabase = createServiceClient();

    let competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await resolveCompetitionIdForAdminRequest(req, supabase);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition" }, { status: 404 });
    }
    const resolvedCompetitionId = competitionId;
    logContext = {
      competitionId: resolvedCompetitionId,
      season,
      triggerMode,
      requestPath,
    };

    async function respond(status: number, body: Record<string, unknown>) {
      try {
        const classification = classifySnapshotRun(body, status);
        const logError = await recordAutomationJobRun({
          competitionId: resolvedCompetitionId,
          season,
          jobKind: "snapshot_odds_due",
          triggerMode,
          requestPath,
          startedAtUtc,
          finishedAtUtc: new Date().toISOString(),
          runStatus: classification.runStatus,
          summary: classification.summary,
          details: body,
        });
        if (logError) {
          body.observability_log_error = logError;
        }

        const auditError = await recordAdminAuditEvent({
          competitionId: resolvedCompetitionId,
          season,
          actionType: "snapshot_odds_due",
          resultStatus: classification.runStatus,
          actorMode: triggerMode,
          actorUserId,
          targetType: "season",
          targetLabel: `Season ${season}`,
          summary: classification.summary,
          requestPath,
          details: body,
        });
        if (auditError) {
          console.warn("admin audit log failed after snapshot due check", auditError);
        }
      } catch (error: unknown) {
        body.observability_log_error =
          error instanceof Error ? error.message : "Failed to record automation run";
      }

      return NextResponse.json(body, { status });
    }

    const competitionFromQuery = url.searchParams.get("competition_id")?.trim() ?? "";
    if (gate.mode === "cron" && !competitionFromQuery) {
      const { count } = await supabase
        .from("rounds")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId)
        .eq("season", season);

      if ((count ?? 0) === 0) {
        const { data: seasonRounds } = await supabase
          .from("rounds")
          .select("competition_id, round_number")
          .eq("season", season)
          .order("round_number", { ascending: true })
          .limit(500);

        const fallbackComp = (seasonRounds ?? []).find((r) => !!r.competition_id)?.competition_id ?? null;
        if (fallbackComp) competitionId = String(fallbackComp);
      }
    }

    // Fetch rounds
    let q = supabase
      .from("rounds")
      .select("round_number, lock_time_utc, odds_snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (onlyRoundParam !== null) {
      q = q.eq("round_number", Number(onlyRoundParam));
    }

    const { data: rounds, error } = await q;
    if (error) {
      return respond(500, {
        error: "Failed to read rounds",
        details: error.message,
      });
    }

    if (!rounds?.length) {
      return respond(200, {
        ok: true,
        season,
        competition_id: resolvedCompetitionId,
        processedDueRounds: 0,
        capturedRounds: 0,
        next: null,
        results: [],
      });
    }

    const now = new Date();

    // Build enriched list (rounds already ordered by round_number)
    const enriched = (rounds as RoundRow[]).map((r) => {
      const snapshotForTimeUtc = computeSnapshotDueTimeUtc(r.lock_time_utc);
      const due = now >= new Date(snapshotForTimeUtc);
      const alreadyCaptured = isSameInstant(r.odds_snapshot_for_time_utc, snapshotForTimeUtc);
      return {
        round_number: r.round_number,
        lock_time_utc: r.lock_time_utc,
        storedSnapshotForTimeUtc: r.odds_snapshot_for_time_utc,
        snapshotForTimeUtc,
        due,
        alreadyCaptured,
      };
    });

    const nextUpcomingPendingRound =
      enriched.find((r) => !r.due && !r.alreadyCaptured) ?? null;
    const firstDuePendingRound =
      enriched.find((r) => r.due && !r.alreadyCaptured) ?? null;

    // Decide which single round to act on
    // - If ?round= is provided, list is already restricted to that one.
    // - Otherwise:
    //    * normal mode: pick first due round that has not already been captured
    //    * force mode: pick next upcoming round (first not-due); if none, fall back to last
    let target: (typeof enriched)[number] | null = null;

    if (onlyRoundParam !== null) {
      target = enriched[0] ?? null;
    } else if (force) {
      target =
        nextUpcomingPendingRound ??
        enriched.find((r) => !r.due) ??
        enriched[enriched.length - 1] ??
        null;
    } else {
      target = firstDuePendingRound;
    }

    if (!target) {
      return respond(200, {
        ok: true,
        season,
        competition_id: resolvedCompetitionId,
        processedDueRounds: 0,
        capturedRounds: 0,
        skipped_reason: "no_due_rounds_pending_capture",
        next: nextUpcomingPendingRound
          ? {
              round: nextUpcomingPendingRound.round_number,
              due: false,
              alreadyCaptured: false,
              snapshotForTimeUtc: nextUpcomingPendingRound.snapshotForTimeUtc,
              lockTimeUtc: nextUpcomingPendingRound.lock_time_utc,
            }
          : null,
        results: [],
      });
    }

    const shouldRun = force || (target.due && !target.alreadyCaptured);

    // If we’re not running (not due yet / already captured and not forced), return single “next”
    if (!shouldRun) {
      const skippedReason = target.due
        ? "already_captured_for_due_snapshot"
        : "not_due_yet";
      return respond(200, {
        ok: true,
        season,
        competition_id: resolvedCompetitionId,
        processedDueRounds: 0,
        capturedRounds: 0,
        skipped_reason: skippedReason,
        next: {
          round: target.round_number,
          due: target.due,
          alreadyCaptured: target.alreadyCaptured,
          storedSnapshotForTimeUtc: target.storedSnapshotForTimeUtc,
          snapshotForTimeUtc: target.snapshotForTimeUtc,
          lockTimeUtc: target.lock_time_utc,
        },
        results: [
          {
            round: target.round_number,
            due: target.due,
            alreadyCaptured: target.alreadyCaptured,
            snapshotForTimeUtc: target.snapshotForTimeUtc,
            note:
              skippedReason === "already_captured_for_due_snapshot"
                ? "Already captured for this due snapshot"
                : "Not due yet",
          },
        ],
      });
    }

    // Run snapshot for the chosen target
    const secretQS =
      triggerMode === "cron"
        ? `&secret=${encodeURIComponent(cronSecret ?? "")}`
        : "";

    // ✅ IMPORTANT: pass force to snapshot-odds when force=1
    const forceQS = force ? `&force=1` : "";

    const snapUrl = `${url.origin}/api/admin/snapshot-odds?season=${season}&round=${target.round_number}${forceQS}${secretQS}`;
    const snapUrlWithComp = `${snapUrl}&competition_id=${encodeURIComponent(resolvedCompetitionId)}`;

    const headers: Record<string, string> = {};
    if (triggerMode === "bearer" && bearerToken) {
      headers["Authorization"] = `Bearer ${bearerToken}`;
    }

    const res = await fetch(snapUrlWithComp, { headers, cache: "no-store" });
    const text = await res.text();

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = {
        error: "Non-JSON response",
        status: res.status,
        bodyHead: text.slice(0, 800),
      };
    }

    const jsonOk =
      typeof json === "object" &&
      json !== null &&
      "ok" in json &&
      (json as { ok?: unknown }).ok === true;
    const capturedRounds = res.status === 200 && jsonOk ? 1 : 0;

    return respond(200, {
      ok: true,
      season,
      competition_id: resolvedCompetitionId,
      processedDueRounds: 1,
      capturedRounds,
      snapshotHoursBeforeLock: SNAPSHOT_HOURS_BEFORE_LOCK,
      next: {
        round: target.round_number,
        due: target.due,
        alreadyCaptured: target.alreadyCaptured,
        snapshotForTimeUtc: target.snapshotForTimeUtc,
        lockTimeUtc: target.lock_time_utc,
      },
      results: [
        {
          round: target.round_number,
          due: target.due,
          alreadyCaptured: target.alreadyCaptured,
          snapshotForTimeUtc: target.snapshotForTimeUtc,
          status: res.status,
          snapshotResult: json,
        },
      ],
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    if (logContext) {
      try {
        await recordAutomationJobRun({
          competitionId: logContext.competitionId,
          season: logContext.season,
          jobKind: "snapshot_odds_due",
          triggerMode: logContext.triggerMode,
          requestPath: logContext.requestPath,
          startedAtUtc,
          finishedAtUtc: new Date().toISOString(),
          runStatus: "failed",
          summary: details,
          details: { error: "Unexpected error", details },
        });
      } catch {
        // Swallow logging failures so caller still receives the original error response.
      }
    }
    return NextResponse.json(
      { error: "Unexpected error", details, started_at_utc: startedAtUtc },
      { status: 500 }
    );
  }
}
