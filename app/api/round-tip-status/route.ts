import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getBearer, isAdminBearerForCompetition } from "@/lib/admin-auth";

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

type MembershipRow = {
  user_id: string;
  payment_status?: string | null;
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

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function normalizePaymentStatus(status: string | null | undefined) {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (s === "paid" || s === "pending" || s === "waived") return s;
  return null;
}

export async function GET(req: Request) {
  try {
    // Require a logged-in user (anyone) to prevent public scraping
    const token = getBearer(req);
    if (!token) return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");

    const supabase = createServiceClient();
    // single-comp MVP
    const { data: comp, error: cErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (cErr || !comp) {
      return NextResponse.json({ error: "No competition found", details: cErr?.message ?? "" }, { status: 404 });
    }
    const admin = await isAdminBearerForCompetition(req, String(comp.id));

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
    let members: MembershipRow[] = [];
    const withPayment = await supabase
      .from("memberships")
      .select("user_id, payment_status")
      .eq("competition_id", comp.id);

    if (withPayment.error && isMissingColumnError(withPayment.error.message, "payment_status")) {
      const fallback = await supabase
        .from("memberships")
        .select("user_id")
        .eq("competition_id", comp.id);

      if (fallback.error) {
        return NextResponse.json(
          { error: "Failed to read memberships", details: fallback.error.message },
          { status: 500 }
        );
      }

      members = (fallback.data ?? []) as MembershipRow[];
    } else if (withPayment.error) {
      return NextResponse.json(
        { error: "Failed to read memberships", details: withPayment.error.message },
        { status: 500 }
      );
    } else {
      members = (withPayment.data ?? []) as MembershipRow[];
    }

    const memberIds = members.map((m) => m.user_id);
    const memberSet = new Set(memberIds);
    const paymentStatusByUserId = new Map<string, string | null>();
    members.forEach((m) => {
      paymentStatusByUserId.set(
        String(m.user_id),
        normalizePaymentStatus(m.payment_status ?? null)
      );
    });

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

      let missing:
        | Array<{ user_id: string; display_name: string | null; payment_status: string | null }>
        | undefined = undefined;

      if (admin) {
        const miss: Array<{ user_id: string; display_name: string | null; payment_status: string | null }> = [];
        for (const uid of memberIds) {
          if (!tipped.has(uid)) {
            miss.push({
              user_id: uid,
              display_name: profileMap.get(uid) ?? null,
              payment_status: paymentStatusByUserId.get(uid) ?? null,
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
