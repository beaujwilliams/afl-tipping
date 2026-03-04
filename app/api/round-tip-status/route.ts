import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

async function isAdmin(req: Request): Promise<boolean> {
  const token = getBearer(req);
  if (!token) return false;

  const authClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data } = await authClient.auth.getUser(token);
  const email = (data.user?.email ?? "").toLowerCase();
  return email === ADMIN_EMAIL.toLowerCase();
}

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

type MembershipRow = {
  user_id: string;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

type MatchRow = {
  id: string;
  round_id: string;
};

type TipRow = {
  user_id: string;
  match_id: string;
};

export async function GET(req: Request) {
  try {
    // Require a logged-in user (anyone) to prevent public scraping
    const token = getBearer(req);
    if (!token) return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");

    const supabase = createServiceClient();
    const admin = await isAdmin(req);

    // single-comp MVP
    const { data: comp, error: cErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (cErr || !comp) {
      return NextResponse.json({ error: "No competition found", details: cErr?.message ?? "" }, { status: 404 });
    }

    // rounds for season
    const { data: rounds, error: rErr } = await supabase
      .from("rounds")
      .select("id, round_number, lock_time_utc")
      .eq("competition_id", comp.id)
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (rErr) {
      return NextResponse.json({ error: "Failed to read rounds", details: rErr.message }, { status: 500 });
    }

    const roundList = (rounds ?? []) as RoundRow[];
    const roundIds = roundList.map((r) => r.id);

    // all members in comp
    const { data: memberships, error: memErr } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", comp.id);

    if (memErr) {
      return NextResponse.json({ error: "Failed to read memberships", details: memErr.message }, { status: 500 });
    }

    const members = (memberships ?? []) as MembershipRow[];
    const memberIds = members.map((m) => m.user_id);
    const memberSet = new Set(memberIds);

    // profiles (for display names)
    const profileMap = new Map<string, string | null>();
    if (memberIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", memberIds);

      (profs as ProfileRow[] | null)?.forEach((p) => {
        profileMap.set(String(p.id), (p.display_name ?? null) ? String(p.display_name) : null);
      });
    }

    // matches in all rounds
    const matchIds: string[] = [];
    const matchToRound = new Map<string, string>();

    if (roundIds.length) {
      const { data: matches, error: mErr } = await supabase
        .from("matches")
        .select("id, round_id")
        .in("round_id", roundIds);

      if (mErr) {
        return NextResponse.json({ error: "Failed to read matches", details: mErr.message }, { status: 500 });
      }

      (matches as MatchRow[] | null)?.forEach((m) => {
        const mid = String(m.id);
        matchIds.push(mid);
        matchToRound.set(mid, String(m.round_id));
      });
    }

    // tips for those matches
    const tipsByRound = new Map<string, Set<string>>(); // round_id -> user_ids who tipped ANY match in that round

    if (matchIds.length) {
      const { data: tips, error: tErr } = await supabase
        .from("tips")
        .select("user_id, match_id")
        .eq("competition_id", comp.id)
        .in("match_id", matchIds);

      if (tErr) {
        return NextResponse.json({ error: "Failed to read tips", details: tErr.message }, { status: 500 });
      }

      (tips as TipRow[] | null)?.forEach((t) => {
        const uid = String(t.user_id);
        if (!memberSet.has(uid)) return;

        const rid = matchToRound.get(String(t.match_id));
        if (!rid) return;

        if (!tipsByRound.has(rid)) tipsByRound.set(rid, new Set());
        tipsByRound.get(rid)!.add(uid);
      });
    }

    // build response
    const out = roundList.map((r) => {
      const tipped = tipsByRound.get(r.id) ?? new Set<string>();
      const tippedCount = tipped.size;
      const totalPlayers = memberIds.length;
      const missingCount = Math.max(0, totalPlayers - tippedCount);

      let missing: Array<{ user_id: string; display_name: string | null }> | undefined = undefined;

      if (admin) {
        const miss: Array<{ user_id: string; display_name: string | null }> = [];
        for (const uid of memberIds) {
          if (!tipped.has(uid)) {
            miss.push({
              user_id: uid,
              display_name: profileMap.get(uid) ?? null,
            });
          }
        }
        missing = miss;
      }

      return {
        round_id: r.id,
        round_number: r.round_number,
        lock_time_utc: r.lock_time_utc,
        total_players: memberIds.length,
        tipped_players: tippedCount,
        missing_players: admin ? missing : undefined,
        missing_count: missingCount,
      };
    });

    return NextResponse.json({
      ok: true,
      season,
      competition_id: comp.id,
      admin,
      rounds: out,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}