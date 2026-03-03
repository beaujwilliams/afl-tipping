import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function allowBearerOrCron(req: Request): Promise<{ ok: boolean; mode?: "cron" | "bearer"; token?: string; secret?: string }> {
  const url = new URL(req.url);

  // Cron mode
  const secret = url.searchParams.get("secret") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && secret && secret === cronSecret) {
    return { ok: true, mode: "cron", secret };
  }

  // Bearer mode
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

export async function GET(req: Request) {
  try {
    const gate = await allowBearerOrCron(req);
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);

    const season = Number(url.searchParams.get("season") || "2026");
    const force = url.searchParams.get("force") === "1";
    const limit = Number(url.searchParams.get("limit") || "0"); // 0 = no limit
    const onlyRound = url.searchParams.get("round"); // optional specific round

    const supabase = createServiceClient();

    // 1 comp MVP
    const { data: comp } = await supabase.from("competitions").select("id").limit(1).single();
    if (!comp) return NextResponse.json({ error: "No competition" }, { status: 404 });

    // Read rounds
    let roundsQuery = supabase
      .from("rounds")
      .select("round_number, lock_time_utc")
      .eq("competition_id", comp.id)
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (onlyRound !== null) {
      roundsQuery = roundsQuery.eq("round_number", Number(onlyRound));
    }

    const { data: rounds, error: rErr } = await roundsQuery;
    if (rErr) return NextResponse.json({ error: "Failed to read rounds", details: rErr.message }, { status: 500 });

    if (!rounds?.length) {
      return NextResponse.json({ ok: true, season, processedDueRounds: 0, capturedRounds: 0, note: "No rounds found" });
    }

    const now = new Date();
    let processedDueRounds = 0;
    let capturedRounds = 0;

    const results: any[] = [];

    // Forward secret down to snapshot-odds when in cron mode
    const secretQS = gate.mode === "cron" ? `&secret=${encodeURIComponent(gate.secret ?? "")}` : "";

    for (const r of rounds) {
      const lock = new Date(r.lock_time_utc);
      const due = force || now >= lock;

      if (!due) {
        results.push({
          round: r.round_number,
          due: false,
          snapshotForTimeUtc: r.lock_time_utc,
          note: "Not due yet",
        });
        continue;
      }

      processedDueRounds++;

      const snapshotUrl =
        `${url.origin}/api/admin/snapshot-odds?season=${season}&round=${r.round_number}${secretQS}`;

      const headers: Record<string, string> = {};
      if (gate.mode === "bearer" && gate.token) headers["Authorization"] = `Bearer ${gate.token}`;

      const res = await fetch(snapshotUrl, { headers, cache: "no-store" });
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
        snapshotForTimeUtc: r.lock_time_utc,
        status: res.status,
        snapshotResult: json,
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
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}