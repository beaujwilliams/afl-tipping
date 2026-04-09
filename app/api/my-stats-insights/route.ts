import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getBearer } from "@/lib/admin-auth";
import { getStatsPagePayload } from "@/lib/stats-data";
import { createClient } from "@/lib/supabase-server";

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

async function getUserFromBearer(req: Request) {
  const token = getBearer(req);
  if (!token) return null;

  const authClient = createSupabaseClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function getAuthedUser(req: Request) {
  const fromBearer = await getUserFromBearer(req);
  if (fromBearer) return fromBearer;

  const authClient = await createClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export async function GET(req: Request) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    if (!Number.isFinite(season)) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    const payload = await getStatsPagePayload({ season, userId: user.id });

    return NextResponse.json({
      ok: true,
      season,
      competition_id: payload.competition_id,
      snapshot: payload.snapshot,
      insights: payload.insights,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load my stats insights", details },
      { status: 500 }
    );
  }
}
