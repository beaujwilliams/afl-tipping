import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function isAdminOrCron(req: Request): Promise<boolean> {
  const url = new URL(req.url);

  // 1) Allow automation via secret
  const secret = url.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;
  if (secret && cronSecret && secret === cronSecret) return true;

  // 2) Allow admin via Bearer token (from /admin page)
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return false;

  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const authClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data } = await authClient.auth.getUser(token);
  return (data.user?.email ?? null) === "beau.j.williams@gmail.com";
}

export async function GET(req: Request) {
  try {
    const allowed = await isAdminOrCron(req);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const force = url.searchParams.get("force") === "1";

    const supabase = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    // Single-comp MVP: just use the first competition
    const { data: comp, error: compErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (compErr || !comp) {
      return NextResponse.json(
        { error: "Competition not found", details: compErr?.message },
        { status: 500 }
      );
    }

    const competitionId = String(comp.id);

    const { data: rounds, error: roundsErr } = await supabase
      .from("rounds")
      .select("round_number, lock_time_utc")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (roundsErr) {
      return NextResponse.json(
        { error: "Failed to read rounds", details: roundsErr.message },
        { status: 500 }
      );
    }

    const now = new Date();
    const results: any[] = [];
    let processedDueRounds = 0;

    const bypassSecret = mustEnv("VERCEL_AUTOMATION_BYPASS_SECRET");

    for (const r of rounds ?? []) {
      const round = Number((r as any).round_number);
      const lockUtc = (r as any).lock_time_utc ? new Date((r as any).lock_time_utc) : null;
      const due = force || (!!lockUtc && now >= lockUtc);

      if (!due) {
        results.push({
          round,
          due: false,
          snapshotForTimeUtc: lockUtc?.toISOString() ?? null,
          note: "Not due yet",
        });
        continue;
      }

      if (!force) {
        const { count, error: cErr } = await supabase
          .from("odds_snapshots")
          .select("id", { count: "exact", head: true })
          .eq("competition_id", competitionId)
          .eq("season", season)
          .eq("round", round);

        if (!cErr && (count ?? 0) > 0) {
          results.push({
            round,
            due: true,
            snapshotForTimeUtc: lockUtc?.toISOString() ?? null,
            note: "Already captured",
          });
          continue;
        }
      }

      processedDueRounds++;

      // Internal call to /api/admin/snapshot-odds
      const base = new URL(req.url);
      const internalUrl = new URL(`${base.origin}/api/admin/snapshot-odds`);
      internalUrl.searchParams.set("season", String(season));
      internalUrl.searchParams.set("round", String(round));
      internalUrl.searchParams.set("secret", mustEnv("CRON_SECRET"));

      // ✅ Bypass Vercel Deployment Protection for server-to-server call
      const resp = await fetch(internalUrl.toString(), {
        method: "GET",
        headers: {
          "x-vercel-protection-bypass": bypassSecret,
        },
      });

      const text = await resp.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: "Non-JSON response", status: resp.status, bodyHead: text.slice(0, 500) };
      }

      results.push({
        round,
        due: true,
        snapshotForTimeUtc: lockUtc?.toISOString() ?? null,
        status: resp.status,
        snapshotResult: json,
      });
    }

    const capturedRounds = results.filter((x) => x.snapshotResult?.ok).length;

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