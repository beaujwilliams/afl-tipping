import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getUserIdFromBearer } from "@/lib/admin-auth";
import { resolveCompetitionIdForSeasonRound } from "@/lib/competition-resolver";
import { resolveReigningChampion } from "@/lib/reigning-champion";

type MatchRow = {
  id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  venue: string | null;
  status: string | null;
  winner_team: string | null;
};

type TipRow = {
  user_id: string;
  match_id: string;
  picked_team: string;
};

type MembershipRow = {
  user_id: string;
  payment_status?: string | null;
  is_test_account?: boolean | null;
};

type OddsRow = {
  match_id: string;
  home_odds: number;
  away_odds: number;
  captured_at_utc: string;
  snapshot_for_time_utc: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

function safeDisplayName(name: string | null | undefined) {
  const n = String(name ?? "").trim();
  return n || "(no display name)";
}

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
    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season"));
    const round = Number(url.searchParams.get("round"));
    const competitionFromQS = url.searchParams.get("competition_id")?.trim() ?? null;

    if (!Number.isFinite(season) || !Number.isFinite(round) || round < 0) {
      return NextResponse.json(
        { ok: false, error: "Provide valid season and round" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const userId = await getUserIdFromBearer(req);

    const competitionId = await resolveCompetitionIdForSeasonRound({
      season,
      round,
      explicitCompetitionId: competitionFromQS,
      userId,
      supabase,
    });

    if (!competitionId) {
      return NextResponse.json({ ok: false, error: "No competition found" }, { status: 404 });
    }

    const reigningChampion = await resolveReigningChampion({
      competitionId,
      season,
      supabase,
    });

    const { data: roundRow, error: rErr } = await supabase
      .from("rounds")
      .select("id, lock_time_utc, odds_snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .eq("round_number", round)
      .single();

    if (rErr || !roundRow?.id) {
      return NextResponse.json({ ok: false, error: "Round not found" }, { status: 404 });
    }

    const roundId = String(roundRow.id);
    const snapshotForTimeUtc = roundRow.odds_snapshot_for_time_utc ?? null;
    const lockTimeUtc = roundRow.lock_time_utc ?? null;
    const lockMs = lockTimeUtc ? new Date(lockTimeUtc).getTime() : NaN;

    // Never expose round results before lock.
    if (!Number.isFinite(lockMs) || Date.now() < lockMs) {
      return NextResponse.json(
        {
          ok: false,
          error: "Round results are available only after the round locks.",
          lock_time_utc: lockTimeUtc,
        },
        { status: 403 }
      );
    }

    const { data: matches, error: mErr } = await supabase
      .from("matches")
      .select("id, commence_time_utc, home_team, away_team, venue, status, winner_team")
      .eq("round_id", roundId)
      .order("commence_time_utc", { ascending: true });

    if (mErr) {
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
    }

    const matchList = (matches ?? []) as MatchRow[];
    const matchIds = matchList.map((m) => String(m.id));
    const completedGamesInRound = matchList.reduce((acc, m) => {
      return acc + (String(m.winner_team ?? "").trim() ? 1 : 0);
    }, 0);

    if (!matchIds.length) {
      return NextResponse.json({
        ok: true,
        season,
        round,
        reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
        round_id: roundId,
        lock_time_utc: lockTimeUtc,
        snapshot_for_time_utc: snapshotForTimeUtc,
        matches: [],
        players: [],
      });
    }

    const { data: tips, error: tErr } = await supabase
      .from("tips")
      .select("user_id, match_id, picked_team")
      .eq("competition_id", competitionId)
      .in("match_id", matchIds);

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    const tipRows = (tips ?? []) as TipRow[];

    const userIds = Array.from(new Set(tipRows.map((t) => String(t.user_id))));

    const eligibleUserIds = new Set<string>();
    const nameByUserId: Record<string, string> = {};
    const paymentStatusByUserId: Record<string, string | null> = {};
    if (userIds.length) {
      const withPaymentAndTest = await supabase
        .from("memberships")
        .select("user_id, payment_status, is_test_account")
        .eq("competition_id", competitionId)
        .in("user_id", userIds);

      let membershipRows: MembershipRow[] = [];
      if (
        withPaymentAndTest.error &&
        (isMissingColumnError(withPaymentAndTest.error.message, "payment_status") ||
          isMissingColumnError(withPaymentAndTest.error.message, "is_test_account"))
      ) {
        const hasPaymentStatus = !isMissingColumnError(
          withPaymentAndTest.error.message,
          "payment_status"
        );
        const hasTestFlag = !isMissingColumnError(
          withPaymentAndTest.error.message,
          "is_test_account"
        );
        const fallbackColumns = [
          "user_id",
          ...(hasPaymentStatus ? ["payment_status"] : []),
          ...(hasTestFlag ? ["is_test_account"] : []),
        ];
        const fallback = await supabase
          .from("memberships")
          .select(fallbackColumns.join(", "))
          .eq("competition_id", competitionId)
          .in("user_id", userIds);

        if (fallback.error) {
          return NextResponse.json({ ok: false, error: fallback.error.message }, { status: 500 });
        }
        membershipRows = (fallback.data ?? []) as unknown as MembershipRow[];
      } else if (withPaymentAndTest.error) {
        return NextResponse.json({ ok: false, error: withPaymentAndTest.error.message }, { status: 500 });
      } else {
        membershipRows = (withPaymentAndTest.data ?? []) as unknown as MembershipRow[];
      }

      membershipRows.forEach((m) => {
        if (Boolean(m.is_test_account)) return;
        const uid = String(m.user_id);
        eligibleUserIds.add(uid);
        paymentStatusByUserId[uid] = normalizePaymentStatus(m.payment_status ?? null);
      });

      const eligibleIdList = Array.from(eligibleUserIds);
      if (eligibleIdList.length > 0) {
        const { data: profiles, error: pErr } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", eligibleIdList);

        if (pErr) {
          return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
        }

        (profiles as ProfileRow[] | null)?.forEach((p) => {
          nameByUserId[String(p.id)] = safeDisplayName(p.display_name);
        });
      }
    }

    let oddsQuery = supabase
      .from("match_odds")
      .select("match_id, home_odds, away_odds, captured_at_utc, snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .in("match_id", matchIds);

    if (snapshotForTimeUtc) {
      oddsQuery = oddsQuery.eq("snapshot_for_time_utc", snapshotForTimeUtc);
    } else {
      oddsQuery = oddsQuery.order("snapshot_for_time_utc", { ascending: false });
    }

    oddsQuery = oddsQuery.order("captured_at_utc", { ascending: false });

    const { data: oddsRows, error: oErr } = await oddsQuery;

    if (oErr) {
      return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 });
    }

    const oddsByMatchId: Record<string, { home_odds: number; away_odds: number }> = {};
    (oddsRows as OddsRow[] | null)?.forEach((row) => {
      const mid = String(row.match_id);
      if (!oddsByMatchId[mid]) {
        oddsByMatchId[mid] = {
          home_odds: Number(row.home_odds ?? 0),
          away_odds: Number(row.away_odds ?? 0),
        };
      }
    });

    const teamCountByMatch: Record<string, Record<string, number>> = {};
    const totalTipsByMatch: Record<string, number> = {};

    const playersById: Record<
      string,
      {
        user_id: string;
        display_name: string;
        payment_status: string | null;
        round_score: number;
        potential_score: number;
        correct_tips: number;
        total_tips: number;
        correct_odds_sum: number;
        picks: Record<string, string>;
      }
    > = {};

    const matchById: Record<string, MatchRow> = {};
    for (const m of matchList) matchById[m.id] = m;

    for (const t of tipRows) {
      const uid = String(t.user_id);
      if (!eligibleUserIds.has(uid)) continue;
      const mid = String(t.match_id);
      const pickedTeam = String(t.picked_team ?? "").trim();
      if (!pickedTeam || !matchById[mid]) continue;

      const m = matchById[mid];
      const winner = String(m.winner_team ?? "").trim();
      const isFinished = !!winner;

      if (!teamCountByMatch[mid]) teamCountByMatch[mid] = {};
      teamCountByMatch[mid][pickedTeam] = (teamCountByMatch[mid][pickedTeam] ?? 0) + 1;
      totalTipsByMatch[mid] = (totalTipsByMatch[mid] ?? 0) + 1;

      const odds = oddsByMatchId[mid];
      let pickedOdds = 0;
      if (odds) {
        if (pickedTeam === m.home_team) pickedOdds = Number(odds.home_odds ?? 0);
        else if (pickedTeam === m.away_team) pickedOdds = Number(odds.away_odds ?? 0);
      }
      let points = 0;
      let isCorrect: boolean | null = null;

      if (isFinished) {
        isCorrect = pickedTeam === winner;
        if (isCorrect) points = pickedOdds;
      }

      if (!playersById[uid]) {
        playersById[uid] = {
          user_id: uid,
          display_name: nameByUserId[uid] ?? "Anonymous tipster",
          payment_status: paymentStatusByUserId[uid] ?? null,
          round_score: 0,
          potential_score: 0,
          correct_tips: 0,
          total_tips: 0,
          correct_odds_sum: 0,
          picks: {},
        };
      }

      playersById[uid].total_tips += 1;
      playersById[uid].potential_score += pickedOdds;
      playersById[uid].picks[mid] = pickedTeam;

      if (isCorrect) {
        playersById[uid].correct_tips += 1;
        playersById[uid].round_score += points;
        playersById[uid].correct_odds_sum += points;
      }
    }

    const matchesOut = matchList.map((m) => {
      const mid = m.id;
      const totalTips = totalTipsByMatch[mid] ?? 0;
      const byTeam = teamCountByMatch[mid] ?? {};
      const homeCount = byTeam[m.home_team] ?? 0;
      const awayCount = byTeam[m.away_team] ?? 0;
      const homePct = totalTips ? Math.round((homeCount / totalTips) * 100) : 0;
      const awayPct = totalTips ? Math.round((awayCount / totalTips) * 100) : 0;

      return {
        ...m,
        total_tips: totalTips,
        tipping: {
          home_team: m.home_team,
          away_team: m.away_team,
          home_count: homeCount,
          away_count: awayCount,
          home_pct: homePct,
          away_pct: awayPct,
        },
      };
    });

    const players = Object.values(playersById)
      .map((p) => {
        const accuracyBase = completedGamesInRound > 0 ? completedGamesInRound : 0;
        const accuracyCorrect = accuracyBase > 0 ? Math.min(p.correct_tips, accuracyBase) : 0;
        const accuracyPct = accuracyBase > 0 ? (accuracyCorrect / accuracyBase) * 100 : 0;
        const avgCorrectOdds = p.correct_tips > 0 ? p.correct_odds_sum / p.correct_tips : 0;
        const differenceScore = p.potential_score - p.round_score;
        return {
          user_id: p.user_id,
          display_name: p.display_name,
          payment_status: p.payment_status,
          round_score: p.round_score,
          potential_score: p.potential_score,
          difference_score: differenceScore,
          correct_tips: p.correct_tips,
          total_tips: p.total_tips,
          accuracy_pct: accuracyPct,
          avg_correct_odds: avgCorrectOdds,
          picks: p.picks,
        };
      })
      .sort((a, b) => {
        if (b.round_score !== a.round_score) return b.round_score - a.round_score;
        if (b.correct_tips !== a.correct_tips) return b.correct_tips - a.correct_tips;
        return a.display_name.localeCompare(b.display_name);
      });

    return NextResponse.json({
      ok: true,
      season,
      round,
      reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
      round_id: roundId,
      lock_time_utc: lockTimeUtc,
      snapshot_for_time_utc: snapshotForTimeUtc,
      matches: matchesOut,
      players,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
