import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

type RoundRow = {
  id: string;
  round_number: number;
  odds_snapshot_for_time_utc: string | null;
};

type MatchRow = {
  id: string;
  round_id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  winner_team: string | null;
};

type OddsRow = {
  match_id: string;
  home_odds: number | null;
  away_odds: number | null;
  snapshot_for_time_utc: string | null;
  captured_at_utc: string;
};

type TipRow = {
  user_id: string;
  match_id: string;
  picked_team: string | null;
};

type MembershipRow = {
  user_id: string;
  payment_status?: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

type ScoredMatch = {
  id: string;
  round_number: number;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  winner_team: string;
  home_odds: number;
  away_odds: number;
};

type UserStats = {
  user_id: string;
  display_name: string;
  tips_submitted: number;
  correct_tips: number;
  total_points: number;
  correct_points_sum: number;
  points_by_round: Record<number, number>;
  correct_by_round: Record<number, number>;
  picks_by_match: Map<string, string>;
};

type LeaderboardRow = {
  user_id: string;
  display_name: string;
  payment_status: string | null;
  rank: number;
  total_points: number;
  correct_tips: number;
  tips_submitted: number;
  tips_possible: number;
  missed_tips: number;
  accuracy_pct: number;
  round_score: number;
  movement: number;
  previous_rank: number | null;
  behind_leader: number;
  current_streak: number;
  avg_winning_odds: number;
};

function safeDisplayName(name: string | null | undefined, userId: string) {
  const n = String(name ?? "").trim();
  if (n) return n;
  return `${userId.slice(0, 8)}...`;
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

function round2(v: number) {
  return Number(v.toFixed(2));
}

function rankComparator(
  a: { total_points: number; correct_tips: number; display_name: string },
  b: { total_points: number; correct_tips: number; display_name: string }
) {
  if (b.total_points !== a.total_points) return b.total_points - a.total_points;
  if (b.correct_tips !== a.correct_tips) return b.correct_tips - a.correct_tips;
  return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
}

function sumUpTo(roundMap: Record<number, number>, maxRound: number | null) {
  if (maxRound === null) return 0;

  let total = 0;
  for (const [roundKey, value] of Object.entries(roundMap)) {
    const roundNumber = Number(roundKey);
    if (Number.isFinite(roundNumber) && roundNumber <= maxRound) {
      total += Number(value ?? 0);
    }
  }
  return total;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season"));

    if (!Number.isFinite(season)) {
      return NextResponse.json({ ok: false, error: "Provide a valid season" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: comp, error: cErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (cErr || !comp?.id) {
      return NextResponse.json({ ok: false, error: "No competition found" }, { status: 404 });
    }

    const competitionId = String(comp.id);

    const { data: rounds, error: rErr } = await supabase
      .from("rounds")
      .select("id, round_number, odds_snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (rErr) {
      return NextResponse.json(
        { ok: false, error: "Failed to read rounds", details: rErr.message },
        { status: 500 }
      );
    }

    const roundRows = (rounds ?? []) as RoundRow[];
    const roundIds = roundRows.map((r) => String(r.id));

    if (roundIds.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        competition_id: competitionId,
        latest_scored_round: null,
        previous_round_for_movement: null,
        rows: [],
      });
    }

    const roundById = new Map<string, RoundRow>();
    roundRows.forEach((r) => roundById.set(String(r.id), r));

    const { data: matches, error: mErr } = await supabase
      .from("matches")
      .select("id, round_id, commence_time_utc, home_team, away_team, winner_team")
      .in("round_id", roundIds)
      .order("commence_time_utc", { ascending: true });

    if (mErr) {
      return NextResponse.json(
        { ok: false, error: "Failed to read matches", details: mErr.message },
        { status: 500 }
      );
    }

    const matchRows = (matches ?? []) as MatchRow[];

    const lockedSnapshotByMatchId = new Map<string, string>();
    const candidateMatchIds: string[] = [];

    for (const m of matchRows) {
      const round = roundById.get(String(m.round_id));
      if (!round) continue;

      const winner = String(m.winner_team ?? "").trim();
      const snapshot = String(round.odds_snapshot_for_time_utc ?? "").trim();
      if (!winner || !snapshot) continue;

      const matchId = String(m.id);
      candidateMatchIds.push(matchId);
      lockedSnapshotByMatchId.set(matchId, snapshot);
    }

    const oddsByMatchId = new Map<string, { home_odds: number; away_odds: number }>();

    if (candidateMatchIds.length > 0) {
      const uniqueSnapshots = Array.from(new Set(Array.from(lockedSnapshotByMatchId.values())));

      const { data: oddsRows, error: oErr } = await supabase
        .from("match_odds")
        .select("match_id, home_odds, away_odds, snapshot_for_time_utc, captured_at_utc")
        .eq("competition_id", competitionId)
        .in("match_id", candidateMatchIds)
        .in("snapshot_for_time_utc", uniqueSnapshots)
        .order("captured_at_utc", { ascending: false });

      if (oErr) {
        return NextResponse.json(
          { ok: false, error: "Failed to read match odds", details: oErr.message },
          { status: 500 }
        );
      }

      for (const row of (oddsRows ?? []) as OddsRow[]) {
        const matchId = String(row.match_id);
        if (oddsByMatchId.has(matchId)) continue;

        const lockedSnapshot = lockedSnapshotByMatchId.get(matchId);
        const rowSnapshot = String(row.snapshot_for_time_utc ?? "");
        if (!lockedSnapshot || rowSnapshot !== lockedSnapshot) continue;

        oddsByMatchId.set(matchId, {
          home_odds: Number(row.home_odds ?? 0),
          away_odds: Number(row.away_odds ?? 0),
        });
      }
    }

    const scoredMatches: ScoredMatch[] = [];
    let skippedNoOdds = 0;

    for (const m of matchRows) {
      const round = roundById.get(String(m.round_id));
      if (!round) continue;

      const winner = String(m.winner_team ?? "").trim();
      const snapshot = String(round.odds_snapshot_for_time_utc ?? "").trim();
      if (!winner || !snapshot) continue;

      const odds = oddsByMatchId.get(String(m.id));
      if (!odds) {
        skippedNoOdds += 1;
        continue;
      }

      scoredMatches.push({
        id: String(m.id),
        round_number: Number(round.round_number),
        commence_time_utc: String(m.commence_time_utc ?? ""),
        home_team: String(m.home_team ?? ""),
        away_team: String(m.away_team ?? ""),
        winner_team: winner,
        home_odds: Number(odds.home_odds ?? 0),
        away_odds: Number(odds.away_odds ?? 0),
      });
    }

    scoredMatches.sort((a, b) => {
      if (a.round_number !== b.round_number) return a.round_number - b.round_number;
      if (a.commence_time_utc !== b.commence_time_utc) {
        return a.commence_time_utc.localeCompare(b.commence_time_utc);
      }
      return a.id.localeCompare(b.id);
    });

    const scoredMatchIds = scoredMatches.map((m) => m.id);

    let tipRows: TipRow[] = [];
    if (scoredMatchIds.length > 0) {
      const { data: tips, error: tErr } = await supabase
        .from("tips")
        .select("user_id, match_id, picked_team")
        .eq("competition_id", competitionId)
        .in("match_id", scoredMatchIds);

      if (tErr) {
        return NextResponse.json(
          { ok: false, error: "Failed to read tips", details: tErr.message },
          { status: 500 }
        );
      }

      tipRows = (tips ?? []) as TipRow[];
    }

    let memberships: MembershipRow[] = [];
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
          { ok: false, error: "Failed to read memberships", details: fallback.error.message },
          { status: 500 }
        );
      }

      memberships = (fallback.data ?? []) as MembershipRow[];
    } else if (withPayment.error) {
      return NextResponse.json(
        { ok: false, error: "Failed to read memberships", details: withPayment.error.message },
        { status: 500 }
      );
    } else {
      memberships = (withPayment.data ?? []) as MembershipRow[];
    }

    const memberUserIds = new Set<string>(memberships.map((m) => String(m.user_id)));
    const paymentStatusByUserId: Record<string, string | null> = {};
    memberships.forEach((m) => {
      paymentStatusByUserId[String(m.user_id)] = normalizePaymentStatus(m.payment_status ?? null);
    });

    const tipUserIds = new Set<string>();
    const picksByUser = new Map<string, Map<string, string>>();

    for (const tip of tipRows) {
      const userId = String(tip.user_id);
      const matchId = String(tip.match_id);
      const pickedTeam = String(tip.picked_team ?? "").trim();
      if (!pickedTeam) continue;

      tipUserIds.add(userId);
      if (!picksByUser.has(userId)) picksByUser.set(userId, new Map<string, string>());
      picksByUser.get(userId)!.set(matchId, pickedTeam);
    }

    const participantIds = Array.from(new Set([...memberUserIds, ...tipUserIds]));

    const nameByUserId: Record<string, string> = {};
    if (participantIds.length > 0) {
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", participantIds);

      if (pErr) {
        return NextResponse.json(
          { ok: false, error: "Failed to read profiles", details: pErr.message },
          { status: 500 }
        );
      }

      ((profiles ?? []) as ProfileRow[]).forEach((p) => {
        nameByUserId[String(p.id)] = safeDisplayName(p.display_name, String(p.id));
      });
    }

    const statsByUser = new Map<string, UserStats>();
    participantIds.forEach((userId) => {
      statsByUser.set(userId, {
        user_id: userId,
        display_name: safeDisplayName(nameByUserId[userId], userId),
        tips_submitted: 0,
        correct_tips: 0,
        total_points: 0,
        correct_points_sum: 0,
        points_by_round: {},
        correct_by_round: {},
        picks_by_match: picksByUser.get(userId) ?? new Map<string, string>(),
      });
    });

    const latestScoredRound =
      scoredMatches.length > 0
        ? Math.max(...scoredMatches.map((m) => Number(m.round_number)))
        : null;

    const roundsWithScores = Array.from(
      new Set(scoredMatches.map((m) => Number(m.round_number)))
    ).sort((a, b) => a - b);

    const previousRoundForMovement =
      roundsWithScores.length >= 2 ? roundsWithScores[roundsWithScores.length - 2] : null;

    for (const stats of statsByUser.values()) {
      for (const match of scoredMatches) {
        const picked = stats.picks_by_match.get(match.id);
        if (!picked) continue;

        stats.tips_submitted += 1;
        if (picked !== match.winner_team) continue;

        const points =
          match.winner_team === match.home_team ? Number(match.home_odds) : Number(match.away_odds);

        stats.correct_tips += 1;
        stats.total_points += points;
        stats.correct_points_sum += points;

        const roundNo = Number(match.round_number);
        stats.points_by_round[roundNo] = (stats.points_by_round[roundNo] ?? 0) + points;
        stats.correct_by_round[roundNo] = (stats.correct_by_round[roundNo] ?? 0) + 1;
      }
    }

    const tipsPossible = scoredMatches.length;

    const baseRows = Array.from(statsByUser.values()).map((stats) => {
      const missedTips = Math.max(0, tipsPossible - stats.tips_submitted);
      const accuracy = stats.tips_submitted
        ? (stats.correct_tips / stats.tips_submitted) * 100
        : 0;
      const roundScore =
        latestScoredRound === null ? 0 : Number(stats.points_by_round[latestScoredRound] ?? 0);
      const avgWinningOdds =
        stats.correct_tips > 0 ? stats.correct_points_sum / stats.correct_tips : 0;

      let currentStreak = 0;
      for (let i = scoredMatches.length - 1; i >= 0; i -= 1) {
        const match = scoredMatches[i];
        const picked = stats.picks_by_match.get(match.id);
        if (picked && picked === match.winner_team) {
          currentStreak += 1;
          continue;
        }
        break;
      }

      const previousPoints = sumUpTo(stats.points_by_round, previousRoundForMovement);
      const previousCorrect = sumUpTo(stats.correct_by_round, previousRoundForMovement);

      return {
        user_id: stats.user_id,
        display_name: stats.display_name,
        payment_status: paymentStatusByUserId[stats.user_id] ?? null,
        total_points: Number(stats.total_points),
        correct_tips: Number(stats.correct_tips),
        tips_submitted: Number(stats.tips_submitted),
        tips_possible: tipsPossible,
        missed_tips: missedTips,
        accuracy_pct: Number(accuracy),
        round_score: Number(roundScore),
        current_streak: currentStreak,
        avg_winning_odds: Number(avgWinningOdds),
        previous_points: Number(previousPoints),
        previous_correct: Number(previousCorrect),
      };
    });

    const currentRanked = [...baseRows]
      .sort((a, b) =>
        rankComparator(
          {
            total_points: a.total_points,
            correct_tips: a.correct_tips,
            display_name: a.display_name,
          },
          {
            total_points: b.total_points,
            correct_tips: b.correct_tips,
            display_name: b.display_name,
          }
        )
      )
      .map((row, idx) => ({ ...row, rank: idx + 1 }));

    const currentRankByUser = new Map<string, number>();
    currentRanked.forEach((row) => currentRankByUser.set(row.user_id, row.rank));

    const previousRankByUser = new Map<string, number>();
    if (previousRoundForMovement !== null) {
      [...baseRows]
        .sort((a, b) =>
          rankComparator(
            {
              total_points: a.previous_points,
              correct_tips: a.previous_correct,
              display_name: a.display_name,
            },
            {
              total_points: b.previous_points,
              correct_tips: b.previous_correct,
              display_name: b.display_name,
            }
          )
        )
        .forEach((row, idx) => previousRankByUser.set(row.user_id, idx + 1));
    }

    const leaderPoints = currentRanked.length > 0 ? Number(currentRanked[0].total_points) : 0;

    const rows: LeaderboardRow[] = currentRanked.map((row) => {
      const prevRank = previousRankByUser.get(row.user_id) ?? null;
      const currentRank = currentRankByUser.get(row.user_id) ?? row.rank;
      const movement = prevRank === null ? 0 : prevRank - currentRank;

      return {
        user_id: row.user_id,
        display_name: row.display_name,
        payment_status: row.payment_status,
        rank: row.rank,
        total_points: round2(row.total_points),
        correct_tips: row.correct_tips,
        tips_submitted: row.tips_submitted,
        tips_possible: row.tips_possible,
        missed_tips: row.missed_tips,
        accuracy_pct: round2(row.accuracy_pct),
        round_score: round2(row.round_score),
        movement,
        previous_rank: prevRank,
        behind_leader: round2(Math.max(0, leaderPoints - row.total_points)),
        current_streak: row.current_streak,
        avg_winning_odds: round2(row.avg_winning_odds),
      };
    });

    return NextResponse.json({
      ok: true,
      season,
      competition_id: competitionId,
      latest_scored_round: latestScoredRound,
      previous_round_for_movement: previousRoundForMovement,
      matches_scored: scoredMatches.length,
      matches_skipped_no_odds: skippedNoOdds,
      rows,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "Unexpected error", details: message }, { status: 500 });
  }
}
