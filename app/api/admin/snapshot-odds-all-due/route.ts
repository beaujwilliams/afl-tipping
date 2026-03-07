import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron } from "@/lib/admin-auth";

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

type RoundRow = { round_number: number; lock_time_utc: string };

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || "2026");
    const force = url.searchParams.get("force") === "1";
    const onlyRoundParam = url.searchParams.get("round"); // optional

    const supabase = createServiceClient();

    // MVP: single comp
    const { data: comp } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (!comp) {
      return NextResponse.json({ error: "No competition" }, { status: 404 });
    }

    // Fetch rounds
    let q = supabase
      .from("rounds")
      .select("round_number, lock_time_utc")
      .eq("competition_id", comp.id)
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
      return {
        round_number: r.round_number,
        lock_time_utc: r.lock_time_utc,
        snapshotForTimeUtc,
        due,
      };
    });

    // Decide which single round to act on
    // - If ?round= is provided, list is already restricted to that one.
    // - Otherwise:
    //    * normal mode: pick first due round (in round order)
    //    * force mode: pick next upcoming round (first not-due); if none, fall back to last
    let target: (typeof enriched)[number] | null = null;

    if (onlyRoundParam !== null) {
      target = enriched[0] ?? null;
    } else if (force) {
      target =
        enriched.find((r) => !r.due) ?? enriched[enriched.length - 1] ?? null;
    } else {
      target = enriched.find((r) => r.due) ?? enriched[0] ?? null;
    }

    if (!target) {
      return NextResponse.json({
        ok: true,
        season,
        processedDueRounds: 0,
        capturedRounds: 0,
        next: null,
        results: [],
      });
    }

    const shouldRun = force || target.due;

    // If we’re not running (not due yet and not forced), return single “next”
    if (!shouldRun) {
      return NextResponse.json({
        ok: true,
        season,
        processedDueRounds: 0,
        capturedRounds: 0,
        next: {
          round: target.round_number,
          due: false,
          snapshotForTimeUtc: target.snapshotForTimeUtc,
          lockTimeUtc: target.lock_time_utc,
        },
        results: [
          {
            round: target.round_number,
            due: false,
            snapshotForTimeUtc: target.snapshotForTimeUtc,
            note: "Not due yet",
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

    const headers: Record<string, string> = {};
    if (gate.mode === "bearer" && gate.token) {
      headers["Authorization"] = `Bearer ${gate.token}`;
    }

    const res = await fetch(snapUrl, { headers, cache: "no-store" });
    const text = await res.text();

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = {
        error: "Non-JSON response",
        status: res.status,
        bodyHead: text.slice(0, 800),
      };
    }

    const capturedRounds = res.status === 200 && json?.ok ? 1 : 0;

    return NextResponse.json({
      ok: true,
      season,
      processedDueRounds: 1,
      capturedRounds,
      snapshotHoursBeforeLock: SNAPSHOT_HOURS_BEFORE_LOCK,
      next: {
        round: target.round_number,
        due: true,
        snapshotForTimeUtc: target.snapshotForTimeUtc,
        lockTimeUtc: target.lock_time_utc,
      },
      results: [
        {
          round: target.round_number,
          due: true,
          snapshotForTimeUtc: target.snapshotForTimeUtc,
          status: res.status,
          snapshotResult: json,
        },
      ],
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
