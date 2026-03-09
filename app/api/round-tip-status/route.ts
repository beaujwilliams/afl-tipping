import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getBearer, getUserIdFromBearer, isAdminBearerForCompetition } from "@/lib/admin-auth";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";
import { resolveReigningChampion } from "@/lib/reigning-champion";

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

type RoundPlayerStatusRow = {
  user_id: string;
  display_name: string | null;
  payment_status: string | null;
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
    const competitionFromQS = url.searchParams.get("competition_id")?.trim() ?? null;

    const supabase = createServiceClient();
    const userId = await getUserIdFromBearer(req);
    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const competitionId = await resolveCompetitionIdForSeason({
      season,
      explicitCompetitionId: competitionFromQS,
      userId,
      supabase,
    });

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const reigningChampion = await resolveReigningChampion({
      competitionId,
      season,
      supabase,
    });
    const admin = await isAdminBearerForCompetition(req, competitionId);

    // rounds for season
    const { data: rounds, error: rErr } = await supabase
      .from("rounds")
      .select("id, round_number, lock_time_utc")
      .eq("competition_id", competitionId)
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
      .eq("competition_id", competitionId);

    if (withPayment.error && isMissingColumnError(withPayment.error.message, "payment_status")) {
      const fallback = await supabase
        .from("memberships")
        .select("user_id")
        .eq("competition_id", competitionId);

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
    const totalMatchesByRound = new Map<string, number>();

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
        const rid = String(m.round_id);
        matchIds.push(mid);
        matchToRound.set(mid, rid);
        totalMatchesByRound.set(rid, (totalMatchesByRound.get(rid) ?? 0) + 1);
      });
    }

    // tips for those matches
    const tipsByRound = new Map<string, Set<string>>(); // round_id -> user_ids who tipped ANY match in that round
    const myTipsByRound = new Map<string, number>(); // round_id -> current user's total tips

    if (matchIds.length) {
      const { data: tips, error: tErr } = await supabase
        .from("tips")
        .select("user_id, match_id")
        .eq("competition_id", competitionId)
        .in("match_id", matchIds);

      if (tErr) {
        return NextResponse.json({ error: "Failed to read tips", details: tErr.message }, { status: 500 });
      }

      (tips as TipRow[] | null)?.forEach((t) => {
        const uid = String(t.user_id);
        const rid = matchToRound.get(String(t.match_id));
        if (!rid) return;

        if (uid === userId) {
          myTipsByRound.set(rid, (myTipsByRound.get(rid) ?? 0) + 1);
        }

        if (!memberSet.has(uid)) return;

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
        | Array<RoundPlayerStatusRow>
        | undefined = undefined;
      let tippedPlayersList:
        | Array<RoundPlayerStatusRow>
        | undefined = undefined;

      if (admin) {
        const miss: Array<RoundPlayerStatusRow> = [];
        const tippedRows: Array<RoundPlayerStatusRow> = [];
        for (const uid of memberIds) {
          const row = {
            user_id: uid,
            display_name: profileMap.get(uid) ?? null,
            payment_status: paymentStatusByUserId.get(uid) ?? null,
          };
          if (tipped.has(uid)) tippedRows.push(row);
          else miss.push(row);
        }

        const byName = (a: RoundPlayerStatusRow, b: RoundPlayerStatusRow) => {
          const aName = String(a.display_name ?? "").trim();
          const bName = String(b.display_name ?? "").trim();
          if (aName && bName) {
            const cmp = aName.localeCompare(bName, "en", { sensitivity: "base" });
            if (cmp !== 0) return cmp;
          } else if (aName) {
            return -1;
          } else if (bName) {
            return 1;
          }
          return String(a.user_id).localeCompare(String(b.user_id));
        };

        miss.sort(byName);
        tippedRows.sort(byName);

        missing = miss;
        tippedPlayersList = tippedRows;
      }

      return {
        round_id: r.id,
        round_number: r.round_number,
        lock_time_utc: r.lock_time_utc,
        total_matches: totalMatchesByRound.get(r.id) ?? 0,
        my_tips: myTipsByRound.get(r.id) ?? 0,
        total_players: memberIds.length,
        tipped_players: tippedCount,
        missing_players: admin ? missing : undefined,
        tipped_players_list: admin ? tippedPlayersList : undefined,
        missing_count: missingCount,
      };
    });

    return NextResponse.json({
      ok: true,
      season,
      competition_id: competitionId,
      reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
      admin,
      rounds: out,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
