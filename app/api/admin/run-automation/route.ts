import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season") || "2026");

  const secret = url.searchParams.get("secret") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  const bearer = getBearer(req);

  const okBySecret = cronSecret && secret && secret === cronSecret;
  const okByBearer = !!bearer;

  if (!okBySecret && !okByBearer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
  const secretQS = okBySecret ? `&secret=${encodeURIComponent(secret)}` : "";

  const snapshot_next_due = await call(
    `/api/admin/snapshot-odds-all-due?season=${season}&limit=1${secretQS}`
  );

  const sync_results = await call(`/api/admin/sync-results?season=${season}${secretQS}`);

  // ✅ Only recalc if sync-results succeeded (saves compute + avoids stale/partial updates)
  const syncOk =
    sync_results.status >= 200 &&
    sync_results.status < 300 &&
    (sync_results.json?.ok === true || sync_results.json?.success === true);

  const recalc_leaderboard = syncOk
    ? await call(`/api/admin/recalc-leaderboard?season=${season}${secretQS}`)
    : { status: 412, json: { ok: false, error: "Skipped recalc because sync-results failed" } };

  return NextResponse.json({
    ok: true,
    season,
    steps: { snapshot_next_due, sync_results, recalc_leaderboard },
  });
}