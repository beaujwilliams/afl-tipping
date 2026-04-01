import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { resolveReigningChampion } from "@/lib/reigning-champion";
import {
  leaderboardRankComparator,
  pointsForWinningTip,
} from "@/lib/scoring-lock-rules";

type RoundRow = {
  id: string;
  competition_id: string;
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
  is_test_account?: boolean | null;
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
  tips_by_round: Record<number, number>;
  points_by_round: Record<number, number>;
  correct_by_round: Record<number, number>;
  picks_by_match: Map<string, string>;
};

type LeaderboardCacheRow = {
  payload: LeaderboardResponse;
  computed_at: string | null;
};

export type LeaderboardRow = {
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

export type LeaderboardTrendPoint = {
  round_number: number;
  rank: number;
  total_points: number;
};

export type LeaderboardTrendSeries = {
  user_id: string;
  display_name: string;
  payment_status: string | null;
  points: LeaderboardTrendPoint[];
};

export type LeaderboardResponse = {
  ok: true;
  season: number;
  competition_id: string;
  reigning_champion_user_id?: string | null;
  champion_highlight_user_ids?: string[];
  latest_scored_round: number | null;
  previous_round_for_movement: number | null;
  matches_scored: number;
  matches_skipped_no_odds?: number;
  scored_rounds: number[];
  rank_trends: LeaderboardTrendSeries[];
  rows: LeaderboardRow[];
};

const LEADERBOARD_CACHE_CONTROL = "no-store";
const LEADERBOARD_CACHE_TABLE = "leaderboard_snapshot_cache";
const LEADERBOARD_CACHE_MAX_AGE_MS = 2 * 60 * 1000;

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

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
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

function pickCompetitionIdForSeason(roundRows: RoundRow[]) {
  if (!roundRows.length) return null;

  const byCompetition = new Map<string, RoundRow[]>();
  for (const row of roundRows) {
    const competitionId = String(row.competition_id);
    if (!byCompetition.has(competitionId)) byCompetition.set(competitionId, []);
    byCompetition.get(competitionId)!.push(row);
  }

  const picked = Array.from(byCompetition.entries()).sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  })[0];

  return picked?.[0] ?? null;
}

function okJson(payload: object) {
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": LEADERBOARD_CACHE_CONTROL,
    },
  });
}

async function resolveCompetitionIdForSeason(params: {
  season: number;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  const { data: seasonRounds, error: rErr } = await supabase
    .from("rounds")
    .select("id, competition_id, round_number, odds_snapshot_for_time_utc")
    .eq("season", params.season)
    .order("round_number", { ascending: true });

  if (rErr) {
    throw new Error(`Failed to read rounds: ${rErr.message}`);
  }

  const allSeasonRounds = (seasonRounds ?? []) as RoundRow[];
  let competitionId = pickCompetitionIdForSeason(allSeasonRounds);

  if (!competitionId) {
    const { data: comp, error: cErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (cErr || !comp?.id) {
      throw new Error("No competition found");
    }

    competitionId = String(comp.id);
  }

  return {
    competitionId,
    allSeasonRounds,
  };
}

export async function computeLeaderboardSnapshot(params: {
  season: number;
  competitionId?: string | null;
  supabase?: ReturnType<typeof createServiceClient>;
}): Promise<LeaderboardResponse> {
  const supabase = params.supabase ?? createServiceClient();
  const { competitionId: resolvedCompetitionId, allSeasonRounds } =
    await resolveCompetitionIdForSeason({
      season: params.season,
      supabase,
    });

  const competitionId = params.competitionId?.trim() || resolvedCompetitionId;
  const roundRows = allSeasonRounds.filter((r) => String(r.competition_id) === competitionId);
  const reigningChampion = await resolveReigningChampion({
    competitionId,
    season: params.season,
    supabase,
  });

  const roundIds = roundRows.map((r) => String(r.id));

  if (roundIds.length === 0) {
    return {
      ok: true,
      season: params.season,
      competition_id: competitionId,
      reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
      champion_highlight_user_ids: reigningChampion.champion_highlight_user_ids,
      latest_scored_round: null,
      previous_round_for_movement: null,
      matches_scored: 0,
      scored_rounds: [],
      rank_trends: [],
      rows: [],
    };
  }

  const roundById = new Map<string, RoundRow>();
  roundRows.forEach((r) => roundById.set(String(r.id), r));

  const { data: matches, error: mErr } = await supabase
    .from("matches")
    .select("id, round_id, commence_time_utc, home_team, away_team, winner_team")
    .in("round_id", roundIds)
    .order("commence_time_utc", { ascending: true });

  if (mErr) {
    throw new Error(`Failed to read matches: ${mErr.message}`);
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
      throw new Error(`Failed to read match odds: ${oErr.message}`);
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
      throw new Error(`Failed to read tips: ${tErr.message}`);
    }

    tipRows = (tips ?? []) as TipRow[];
  }

  let memberships: MembershipRow[] = [];
  const withPaymentAndTest = await supabase
    .from("memberships")
    .select("user_id, payment_status, is_test_account")
    .eq("competition_id", competitionId);

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
      .eq("competition_id", competitionId);

    if (fallback.error) {
      throw new Error(`Failed to read memberships: ${fallback.error.message}`);
    }

    memberships = (fallback.data ?? []) as unknown as MembershipRow[];
  } else if (withPaymentAndTest.error) {
    throw new Error(`Failed to read memberships: ${withPaymentAndTest.error.message}`);
  } else {
    memberships = (withPaymentAndTest.data ?? []) as unknown as MembershipRow[];
  }

  const memberUserIds = new Set<string>(
    memberships
      .filter((m) => !Boolean(m.is_test_account))
      .map((m) => String(m.user_id))
  );
  const paymentStatusByUserId: Record<string, string | null> = {};
  memberships
    .filter((m) => !Boolean(m.is_test_account))
    .forEach((m) => {
      paymentStatusByUserId[String(m.user_id)] = normalizePaymentStatus(
        m.payment_status ?? null
      );
    });

  const tipUserIds = new Set<string>();
  const picksByUser = new Map<string, Map<string, string>>();

  for (const tip of tipRows) {
    const userId = String(tip.user_id);
    if (!memberUserIds.has(userId)) continue;
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
      throw new Error(`Failed to read profiles: ${pErr.message}`);
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
      tips_by_round: {},
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

      const roundNo = Number(match.round_number);
      stats.tips_submitted += 1;
      stats.tips_by_round[roundNo] = (stats.tips_by_round[roundNo] ?? 0) + 1;
      if (picked !== match.winner_team) continue;

      const points = pointsForWinningTip({
        pickedTeam: picked,
        winnerTeam: match.winner_team,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        homeOdds: match.home_odds,
        awayOdds: match.away_odds,
      });

      stats.correct_tips += 1;
      stats.total_points += points;
      stats.correct_points_sum += points;

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
    const previousTips = sumUpTo(stats.tips_by_round, previousRoundForMovement);
    const previousAccuracy = previousTips ? (previousCorrect / previousTips) * 100 : 0;

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
      previous_accuracy_pct: Number(previousAccuracy),
    };
  });

  const currentRanked = [...baseRows]
    .sort((a, b) =>
      leaderboardRankComparator(
        {
          total_points: a.total_points,
          accuracy_pct: a.accuracy_pct,
          correct_tips: a.correct_tips,
          display_name: a.display_name,
        },
        {
          total_points: b.total_points,
          accuracy_pct: b.accuracy_pct,
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
        leaderboardRankComparator(
          {
            total_points: a.previous_points,
            accuracy_pct: a.previous_accuracy_pct,
            correct_tips: a.previous_correct,
            display_name: a.display_name,
          },
          {
            total_points: b.previous_points,
            accuracy_pct: b.previous_accuracy_pct,
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

  const rankTrendByUserId = new Map<string, LeaderboardTrendPoint[]>();
  statsByUser.forEach((stats) => {
    rankTrendByUserId.set(stats.user_id, []);
  });

  for (const roundNo of roundsWithScores) {
    const rankedAtRound = Array.from(statsByUser.values())
      .map((stats) => {
        const totalPointsAtRound = sumUpTo(stats.points_by_round, roundNo);
        const correctTipsAtRound = sumUpTo(stats.correct_by_round, roundNo);
        const tipsAtRound = sumUpTo(stats.tips_by_round, roundNo);
        const accuracyAtRound = tipsAtRound > 0 ? (correctTipsAtRound / tipsAtRound) * 100 : 0;
        return {
          user_id: stats.user_id,
          display_name: stats.display_name,
          total_points: totalPointsAtRound,
          accuracy_pct: accuracyAtRound,
          correct_tips: correctTipsAtRound,
        };
      })
      .sort((a, b) =>
        leaderboardRankComparator(
          {
            total_points: a.total_points,
            accuracy_pct: a.accuracy_pct,
            correct_tips: a.correct_tips,
            display_name: a.display_name,
          },
          {
            total_points: b.total_points,
            accuracy_pct: b.accuracy_pct,
            correct_tips: b.correct_tips,
            display_name: b.display_name,
          }
        )
      );

    rankedAtRound.forEach((row, index) => {
      rankTrendByUserId.get(row.user_id)?.push({
        round_number: roundNo,
        rank: index + 1,
        total_points: round2(row.total_points),
      });
    });
  }

  const rankTrends: LeaderboardTrendSeries[] = rows.map((row) => ({
    user_id: row.user_id,
    display_name: row.display_name,
    payment_status: row.payment_status,
    points: rankTrendByUserId.get(row.user_id) ?? [],
  }));

  return {
    ok: true,
    season: params.season,
    competition_id: competitionId,
    reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
    champion_highlight_user_ids: reigningChampion.champion_highlight_user_ids,
    latest_scored_round: latestScoredRound,
    previous_round_for_movement: previousRoundForMovement,
    matches_scored: scoredMatches.length,
    matches_skipped_no_odds: skippedNoOdds,
    scored_rounds: roundsWithScores,
    rank_trends: rankTrends,
    rows,
  };
}

async function readLeaderboardSnapshotCache(params: {
  competitionId: string;
  season: number;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  const { data, error } = await supabase
    .from(LEADERBOARD_CACHE_TABLE)
    .select("payload, computed_at")
    .eq("competition_id", params.competitionId)
    .eq("season", params.season)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error.message, LEADERBOARD_CACHE_TABLE)) {
      return null;
    }
    throw new Error(`Failed to read leaderboard cache: ${error.message}`);
  }

  if (!data) return null;
  return data as LeaderboardCacheRow;
}

async function writeLeaderboardEntries(params: {
  competitionId: string;
  season: number;
  rows: LeaderboardRow[];
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();
  const upserts = params.rows.map((row) => ({
    competition_id: params.competitionId,
    season: params.season,
    user_id: row.user_id,
    total_points: row.total_points,
  }));

  if (!upserts.length) return;

  const { error } = await supabase
    .from("leaderboard_entries")
    .upsert(upserts, { onConflict: "competition_id,season,user_id" });

  if (error && !isMissingRelationError(error.message, "leaderboard_entries")) {
    throw new Error(`Failed to write leaderboard entries: ${error.message}`);
  }
}

async function writeLeaderboardSnapshotCache(params: {
  season: number;
  competitionId: string;
  payload: LeaderboardResponse;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  const { error } = await supabase.from(LEADERBOARD_CACHE_TABLE).upsert(
    {
      competition_id: params.competitionId,
      season: params.season,
      payload: params.payload,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "competition_id,season" }
  );

  if (error && !isMissingRelationError(error.message, LEADERBOARD_CACHE_TABLE)) {
    throw new Error(`Failed to write leaderboard cache: ${error.message}`);
  }
}

export async function refreshLeaderboardSnapshot(params: {
  season: number;
  competitionId?: string | null;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();
  const payload = await computeLeaderboardSnapshot({
    season: params.season,
    competitionId: params.competitionId,
    supabase,
  });

  await Promise.all([
    writeLeaderboardEntries({
      competitionId: payload.competition_id,
      season: params.season,
      rows: payload.rows,
      supabase,
    }),
    writeLeaderboardSnapshotCache({
      competitionId: payload.competition_id,
      season: params.season,
      payload,
      supabase,
    }),
  ]);

  return payload;
}

export async function getLeaderboardSnapshot(params: {
  season: number;
  competitionId?: string | null;
  preferCached?: boolean;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();
  const { competitionId: resolvedCompetitionId } = await resolveCompetitionIdForSeason({
    season: params.season,
    supabase,
  });

  const competitionId = params.competitionId?.trim() || resolvedCompetitionId;
  const cached = await readLeaderboardSnapshotCache({
    competitionId,
    season: params.season,
    supabase,
  });

  if (cached?.payload?.ok) {
    if (params.preferCached) {
      return cached.payload;
    }

    const computedAtMs = cached.computed_at ? new Date(cached.computed_at).getTime() : NaN;
    const fresh =
      Number.isFinite(computedAtMs) &&
      computedAtMs > 0 &&
      Date.now() - computedAtMs <= LEADERBOARD_CACHE_MAX_AGE_MS;
    if (fresh) {
      return cached.payload;
    }
  }

  return refreshLeaderboardSnapshot({
    competitionId,
    season: params.season,
    supabase,
  });
}

export async function invalidateLeaderboardSnapshotCache(params: {
  competitionId: string;
  season?: number | null;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  let query = supabase
    .from(LEADERBOARD_CACHE_TABLE)
    .delete()
    .eq("competition_id", params.competitionId);

  if (params.season !== undefined && params.season !== null) {
    query = query.eq("season", params.season);
  }

  const { error } = await query;
  if (error && !isMissingRelationError(error.message, LEADERBOARD_CACHE_TABLE)) {
    throw new Error(`Failed to invalidate leaderboard cache: ${error.message}`);
  }
}

export { okJson, LEADERBOARD_CACHE_CONTROL };
