import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";
const MEL_TZ = "Australia/Melbourne";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function melDateParts(isoUtc: string): { y: number; m: number; d: number } {
  const dt = new Date(isoUtc);

  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: MEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  return { y, m, d };
}

/**
 * Rule: 12pm Melbourne time the day BEFORE the first match of the round.
 * We use lock_time_utc (first match start) to derive the Melbourne calendar date.
 */
function computeSnapshotDueTimeUtc(lockTimeUtcIso: string): string {
  const { y, m, d } = melDateParts(lockTimeUtcIso);

  // subtract 1 day (calendar)
  const utcMid = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  utcMid.setUTCDate(utcMid.getUTCDate() - 1);

  const yyyy = utcMid.getUTCFullYear();
  const mm = String(utcMid.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utcMid.getUTCDate()).padStart(2, "0");

  // noon Melbourne
  const base = `${yyyy}-${mm}-${dd}T12:00:00`;

  // Try AEDT (+11), then AEST (+10)
  let dt = new Date(`${base}+11:00`);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString();

  dt = new Date(`${base}+10:00`);
  return dt.toISOString();
}

async function allowBearerOrCron(req: Request): Promise<{
  ok: boolean;
  mode?: "cron" | "bearer";
  token?: string;
  secret?: string;
}> {
  const url = new URL(req.url);

  // ✅ Cron secret mode
  const secret = url.searchParams.get("secret") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && secret && secret === cronSecret) {
    return { ok: true, mode: "cron", secret };
  }

  // ✅ Bearer mode (admin UI)
  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return { ok: false };

  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false };

  const authClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data } = await authClient.auth.getUser(token);
  if ((data.user?.email ?? "") !== ADMIN_EMAIL) return { ok: false };

  return { ok: true, mode: "bearer", token };
}

type RoundRow = { round_number: number; lock_time_utc: string };

export async function GET(req: Request) {
  try {
    const gate = await allowBearerOrCron(req);
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

    if (!comp) return NextResponse.json({ error: "No competition" }, { status: 404 });

    // Fetch rounds
    let q = supabase
      .from("rounds")
      .select("round_number, lock_time_utc")
      .eq("competition_id", comp.id)
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (onlyRoundParam !== null) q = q.eq("round_number", Number(onlyRoundParam));

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

    // Build enriched list
    const enriched = (rounds as RoundRow[]).map((r) => {
      const snapshotForTimeUtc = computeSnapshotDueTimeUtc(r.lock_time_utc);
      return {
        round_number: r.round_number,
        lock_time_utc: r.lock_time_utc,
        snapshotForTimeUtc,
        due: now >= new Date(snapshotForTimeUtc),
      };
    });

    // Decide which single round to act on
    let target =
      enriched.find((r) => r.due) ??
      enriched.reduce((best, cur) => {
        // next upcoming (closest snapshot time in future)
        if (!best) return cur;
        const bestT = new Date(best.snapshotForTimeUtc).getTime();
        const curT = new Date(cur.snapshotForTimeUtc).getTime();
        return curT < bestT ? cur : best;
      }, enriched[0]);

    // If onlyRound specified, target is already restricted (fine)
    // If force=1 and onlyRound not specified, we force-run the next upcoming (or earliest)
    const shouldRun = force || target.due;

    let processedDueRounds = 0;
    let capturedRounds = 0;

    // If we’re not running (not due yet and not forced), return single “next”
    if (!shouldRun) {
      const next = target;
      return NextResponse.json({
        ok: true,
        season,
        processedDueRounds,
        capturedRounds,
        next: {
          round: next.round_number,
          due: false,
          snapshotForTimeUtc: next.snapshotForTimeUtc,
          lockTimeUtc: next.lock_time_utc,
        },
        results: [
          {
            round: next.round_number,
            due: false,
            snapshotForTimeUtc: next.snapshotForTimeUtc,
            note: "Not due yet",
          },
        ],
      });
    }

    // Run snapshot for the chosen target
    processedDueRounds = 1;

    const secretQS =
      gate.mode === "cron" ? `&secret=${encodeURIComponent(gate.secret ?? "")}` : "";

    const snapUrl = `${url.origin}/api/admin/snapshot-odds?season=${season}&round=${target.round_number}${secretQS}`;

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
      json = { error: "Non-JSON response", status: res.status, bodyHead: text.slice(0, 800) };
    }

    if (res.status === 200 && json?.ok) capturedRounds = 1;

    return NextResponse.json({
      ok: true,
      season,
      processedDueRounds,
      capturedRounds,
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