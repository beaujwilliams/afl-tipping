import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";

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
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || "2026");
    const force = url.searchParams.get("force") === "1";
    const onlyRoundParam = url.searchParams.get("round"); // optional

    const supabase = createServiceClient();

    let competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await resolveCompetitionIdForAdminRequest(req, supabase);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition" }, { status: 404 });
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
      return NextResponse.json(
        { error: "Failed to read rounds", details: error.message },
        { status: 500 }
      );
    }

    if (!rounds?.length) {
      return NextResponse.json({
        ok: true,
        season,
        competition_id: competitionId,
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
      const alreadyCaptured = String(r.odds_snapshot_for_time_utc ?? "") === snapshotForTimeUtc;
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
      return NextResponse.json({
        ok: true,
        season,
        competition_id: competitionId,
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
      return NextResponse.json({
        ok: true,
        season,
        competition_id: competitionId,
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
      gate.mode === "cron"
        ? `&secret=${encodeURIComponent(gate.secret ?? "")}`
        : "";

    // ✅ IMPORTANT: pass force to snapshot-odds when force=1
    const forceQS = force ? `&force=1` : "";

    const snapUrl = `${url.origin}/api/admin/snapshot-odds?season=${season}&round=${target.round_number}${forceQS}${secretQS}`;
    const snapUrlWithComp = `${snapUrl}&competition_id=${encodeURIComponent(competitionId)}`;

    const headers: Record<string, string> = {};
    if (gate.mode === "bearer" && gate.token) {
      headers["Authorization"] = `Bearer ${gate.token}`;
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

    return NextResponse.json({
      ok: true,
      season,
      competition_id: competitionId,
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
    return NextResponse.json(
      { error: "Unexpected error", details },
      { status: 500 }
    );
  }
}
