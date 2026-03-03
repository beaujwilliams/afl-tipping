import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function isAdminOrCron(req: Request): Promise<{ ok: boolean; reason?: string }> {
  const url = new URL(req.url);

  // Cron secret path (automation)
  const secret = url.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;
  if (secret && cronSecret && secret === cronSecret) return { ok: true };

  // Bearer token path (admin UI)
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return { ok: false, reason: "Missing bearer token" };

  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, reason: "Empty bearer token" };

  const authClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data } = await authClient.auth.getUser(token);
  if (!data.user) return { ok: false, reason: "Invalid session" };

  if ((data.user.email ?? "") !== ADMIN_EMAIL) return { ok: false, reason: "Not admin" };

  return { ok: true };
}

function getBearer(req: Request): string | null {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

export async function GET(req: Request) {
  try {
    const gate = await isAdminOrCron(req);
    if (!gate.ok) return NextResponse.json({ error: "Forbidden", details: gate.reason }, { status: 403 });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");

    const origin = url.origin;

    // If called from Admin UI, forward the same bearer token.
    // If called via cron secret, we call the endpoints with ?secret=...
    const bearer = getBearer(req);
    const cronSecret = process.env.CRON_SECRET;

    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET; // optional but recommended if protection is ON

    const headers: Record<string, string> = {};
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    if (bypass) headers["x-vercel-protection-bypass"] = bypass;

    async function call(path: string) {
      const res = await fetch(`${origin}${path}`, { headers });
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: "Non-JSON response", status: res.status, bodyHead: text.slice(0, 800) };
      }
      return { status: res.status, json };
    }

    // Build URLs: if no bearer, use cron secret query param for each endpoint
    const secretQS = bearer ? "" : `&secret=${encodeURIComponent(cronSecret ?? "")}`;
    if (!bearer && !cronSecret) {
      return NextResponse.json({ error: "Missing CRON_SECRET on server" }, { status: 500 });
    }

    // 1) Snapshot NEXT due round only
    const snap = await call(
      `/api/admin/snapshot-odds-all-due?season=${season}&limit=1${secretQS}`
    );

    // 2) Sync results
    const sync = await call(`/api/admin/sync-results?season=${season}${secretQS}`);

    // 3) Recalc leaderboard
    const recalc = await call(`/api/admin/recalc-leaderboard?season=${season}${secretQS}`);

    return NextResponse.json({
      ok: true,
      season,
      steps: {
        snapshot_next_due: snap,
        sync_results: sync,
        recalc_leaderboard: recalc,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}