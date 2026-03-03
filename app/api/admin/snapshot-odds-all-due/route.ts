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

/**
 * Convert a UTC ISO string to Melbourne calendar parts (Y/M/D).
 */
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
 * Your rule:
 * "12pm AEDT the day before the first game of the round."
 *
 * We approximate this by:
 * - take lock_time_utc (which is first match start time in your system)
 * - convert to Melbourne date
 * - subtract 1 day
 * - set time to 12:00 Melbourne
 * - convert back to UTC ISO
 */
function computeSnapshotDueTimeUtc(lockTimeUtcIso: string): string {
  const { y, m, d } = melDateParts(lockTimeUtcIso);

  // Build a UTC date representing Melbourne midnight for that calendar day,
  // then subtract 1 day, then set Melbourne time 12:00.
  // We'll do this by constructing an ISO string with an explicit offset.
  // Melbourne can be +11 or +10 depending on DST, so try +11 then +10.

  // subtract 1 day on the *calendar*
  const utcMid = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  utcMid.setUTCDate(utcMid.getUTCDate() - 1);

  const yyyy = utcMid.getUTCFullYear();
  const mm = String(utcMid.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utcMid.getUTCDate()).padStart(2, "0");

  // noon Melbourne time
  const base = `${yyyy}-${mm}-${dd}T12:00:00`;

  // Try AEDT (+11) first, then AEST (+10)
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

export async function GET(req: Request) {
  try {
    const gate = await allowBearerOrCron(req);
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || "2026");
    const force = url.searchParams.get("force") === "1";
    const limit = Number(url.searchParams.get("limit") || "0"); // 0 = no limit
    const onlyRound = url.searchParams.get("round"); // optional

    const supabase = createServiceClient();

    // MVP: single comp
    const { data: comp } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (!comp) return NextResponse.json({ error: "No competition" }, { status: 404 });

    // schema: round_number + lock_time_utc
    let q = supabase
      .from("rounds")
      .select("round_number, lock_time_utc")
      .eq("competition_id", comp.id)
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (onlyRound !== null) q = q.eq("round_number", Number(onlyRound));

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
        results: [],
      });
    }

    const now = new Date();
    let processedDueRounds = 0;
    let capturedRounds = 0;
    const results: any[] = [];

    const secretQS =
      gate.mode === "cron" ? `&secret=${encodeURIComponent(gate.secret ?? "")}` : "";

    for (const r of rounds) {
      const dueTimeUtc = computeSnapshotDueTimeUtc(r.lock_time_utc);
      const due = force || now >= new Date(dueTimeUtc);

      if (!due) {
        results.push({
          round: r.round_number,
          due: false,
          snapshotForTimeUtc: dueTimeUtc,
          note: "Not due yet",
        });
        continue;
      }

      processedDueRounds++;

      const snapUrl = `${url.origin}/api/admin/snapshot-odds?season=${season}&round=${r.round_number}${secretQS}`;

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

      if (res.status === 200 && json?.ok) capturedRounds++;

      results.push({
        round: r.round_number,
        due: true,
        snapshotForTimeUtc: dueTimeUtc,
        status: res.status,
        snapshotResult: json,
      });

      if (limit > 0 && capturedRounds >= limit) break;
    }

    return NextResponse.json({ ok: true, season, processedDueRounds, capturedRounds, results });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}