import { NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season") || "2026");
  const gate = await requireAdminOrCron(req);
  if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

  const bearer = gate.mode === "bearer" ? gate.token : null;

  const origin = url.origin;

  async function call(path: string) {
    const headers: Record<string, string> = {};
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;

    const res = await fetch(origin + path, { headers, cache: "no-store" });
    const text = await res.text();
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      return {
        status: res.status,
        json: { error: "Non-JSON response", bodyHead: text.slice(0, 500) },
      };
    }
  }

  // ✅ forward secret to cron-only endpoints
  const secretQS =
    gate.mode === "cron" ? `&secret=${encodeURIComponent(gate.secret)}` : "";

  const prelock_reminders = await call(
    `/api/admin/send-prelock-reminders?season=${season}&hours_before_lock=4&window_minutes=15&window_direction=before${secretQS}`
  );

  const snapshot_next_due = await call(
    `/api/admin/snapshot-odds-all-due?season=${season}&limit=1${secretQS}`
  );

  const sync_results = await call(
    `/api/admin/sync-results?season=${season}&scope=active${secretQS}`
  );

  // ✅ Only recalc if sync-results succeeded (saves compute + avoids stale/partial updates)
  const syncOk =
    sync_results.status >= 200 &&
    sync_results.status < 300 &&
    (sync_results.json?.ok === true || sync_results.json?.success === true);

  const syncUpdated =
    typeof sync_results.json?.updated === "number"
      ? sync_results.json.updated
      : Number(sync_results.json?.updated ?? 0);
  const shouldRecalc = syncOk && Number.isFinite(syncUpdated) && syncUpdated > 0;

  const recalc_leaderboard = shouldRecalc
    ? await call(`/api/admin/recalc-leaderboard?season=${season}${secretQS}`)
    : {
      status: 412,
      json: {
        ok: false,
        error: syncOk
          ? "Skipped recalc because sync-results.updated was 0"
          : "Skipped recalc because sync-results failed",
      },
    };

  return NextResponse.json({
    ok: true,
    season,
    sync_updated: Number.isFinite(syncUpdated) ? syncUpdated : 0,
    recalc_triggered: shouldRecalc,
    steps: {
      prelock_reminders,
      snapshot_next_due,
      sync_results,
      recalc_leaderboard,
    },
  });
}
