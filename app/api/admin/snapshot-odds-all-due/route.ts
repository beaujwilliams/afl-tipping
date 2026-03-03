import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function isAdminOrCron(req: NextRequest): Promise<{ ok: boolean; mode?: "cron" | "bearer"; token?: string }> {
  const url = new URL(req.url);

  // ✅ Cron secret mode
  const secret = url.searchParams.get("secret") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (cronSecret && secret && secret === cronSecret) {
    return { ok: true, mode: "cron" };
  }

  // ✅ Bearer mode
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
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

export async function GET(req: NextRequest) {
  try {
    const gate = await isAdminOrCron(req);
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? new Date().getFullYear());
    const force = url.searchParams.get("force") === "1";
    const limit = Number(url.searchParams.get("limit") ?? "0"); // 0 = unlimited
    const onlyRound = url.searchParams.get("round"); // optional

    // Service role client (we do DB reads here)
    const supabase = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    // Rounds for season
    let roundsQuery = supabase
      .from("rounds")
      .select("season, round, lock_time_utc")
      .eq("season", season)
      .order("round", { ascending: true });

    if (onlyRound !== null) {
      roundsQuery = roundsQuery.eq("round", Number(onlyRound));
    }

    const { data: rounds, error: roundsError } = await roundsQuery;

    if (roundsError) {
      return NextResponse.json({ error: "Failed to read rounds", details: roundsError.message }, { status: 500 });
    }

    if (!rounds?.length) {
      return NextResponse.json({ ok: true, season, processedDueRounds: 0, capturedRounds: 0, note: "No rounds found" });
    }

    const now = new Date();
    let processedDueRounds = 0;
    let capturedRounds = 0;
    const results: any[] = [];

    // If cron mode, forward ?secret=... down to snapshot-odds
    const incomingSecret = url.searchParams.get("secret") ?? "";
    const secretQS = gate.mode === "cron" ? `&secret=${encodeURIComponent(incomingSecret)}` : "";

    for (const r of rounds) {
      const lockTime = new Date(r.lock_time_utc);
      const due = force || now >= lockTime;

      if (!due) {
        results.push({
          round: r.round,
          due: false,
          snapshotForTimeUtc: r.lock_time_utc,
          note: "Not due yet",
        });
        continue;
      }

      processedDueRounds++;

      // Call snapshot-odds on same deployment
      const snapshotUrl = `${url.origin}/api/admin/snapshot-odds?season=${season}&round=${r.round}${secretQS}`;

      const headers: Record<string, string> = {};
      if (gate.mode === "bearer" && gate.token) headers["Authorization"] = `Bearer ${gate.token}`;

      const snapshotRes = await fetch(snapshotUrl, { headers, cache: "no-store" });

      let snapshotResult: any;
      const text = await snapshotRes.text();
      try {
        snapshotResult = JSON.parse(text);
      } catch {
        snapshotResult = {
          error: "Non-JSON response",
          status: snapshotRes.status,
          bodyHead: text.slice(0, 800),
        };
      }

      if (snapshotRes.status === 200) capturedRounds++;

      results.push({
        round: r.round,
        due: true,
        snapshotForTimeUtc: r.lock_time_utc,
        status: snapshotRes.status,
        snapshotResult,
      });

      if (limit > 0 && capturedRounds >= limit) break;
    }

    return NextResponse.json({
      ok: true,
      season,
      processedDueRounds,
      capturedRounds,
      results,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Unexpected error", details: err?.message ?? String(err) }, { status: 500 });
  }
}