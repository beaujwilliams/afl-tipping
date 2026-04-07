import { createServiceClient } from "@/lib/supabase-server";
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

export type MatchResultRow = {
  id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  home_odds: number | null;
  away_odds: number | null;
  venue: string | null;
  status: string | null;
  winner_team: string | null;
  total_tips: number;
  tipping: {
    home_team: string;
    away_team: string;
    home_count: number;
    away_count: number;
    home_pct: number;
    away_pct: number;
  };
};

export type PlayerRoundScore = {
  user_id: string;
  display_name: string;
  payment_status?: string | null;
  round_score: number;
  potential_score: number;
  difference_score: number;
  correct_tips: number;
  total_tips: number;
  accuracy_pct: number;
  avg_correct_odds: number;
  picks: Record<string, string>;
};

export type RoundResultsResponse = {
  ok: true;
  season: number;
  round: number;
  round_id: string;
  reigning_champion_user_id?: string | null;
  champion_highlight_user_ids?: string[];
  champion_seasons_by_user_id?: Record<string, number[]>;
  lock_time_utc: string | null;
  snapshot_for_time_utc: string | null;
  matches: MatchResultRow[];
  players: PlayerRoundScore[];
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

export async function getRoundResultsResponse(params: {
  season: number;
  round: number;
  explicitCompetitionId?: string | null;
  userId?: string | null;
  supabase?: ReturnType<typeof createServiceClient>;
  nowMs?: number;
}): Promise<RoundResultsResponse> {
  const supabase = params.supabase ?? createServiceClient();
  const competitionId = await resolveCompetitionIdForSeasonRound({
    season: params.season,
    round: params.round,
    explicitCompetitionId: params.explicitCompetitionId,
    userId: params.userId ?? null,
    supabase,
  });

  if (!competitionId) {
    throw new Error("No competition found");
  }

  const reigningChampion = await resolveReigningChampion({
    competitionId,
    season: params.season,
    supabase,
  });

  const { data: roundRow, error: rErr } = await supabase
    .from("rounds")
    .select("id, lock_time_utc, odds_snapshot_for_time_utc")
    .eq("competition_id", competitionId)
    .eq("season", params.season)
    .eq("round_number", params.round)
    .single();

  if (rErr || !roundRow?.id) {
    throw new Error("Round not found");
  }

  const roundId = String(roundRow.id);
  const snapshotForTimeUtc = roundRow.odds_snapshot_for_time_utc ?? null;
  const lockTimeUtc = roundRow.lock_time_utc ?? null;
  const lockMs = lockTimeUtc ? new Date(lockTimeUtc).getTime() : NaN;
  const nowMs = params.nowMs ?? Date.now();

  if (!Number.isFinite(lockMs) || nowMs < lockMs) {
    throw new Error("Round results are available only after the round locks.");
  }

  const { data: matches, error: mErr } = await supabase
    .from("matches")
    .select("id, commence_time_utc, home_team, away_team, venue, status, winner_team")
    .eq("round_id", roundId)
    .order("commence_time_utc", { ascending: true });

  if (mErr) {
    throw new Error(mErr.message);
  }

  const matchList = (matches ?? []) as MatchRow[];
  const matchIds = matchList.map((m) => String(m.id));
  const completedGamesInRound = matchList.reduce((acc, m) => {
    return acc + (String(m.winner_team ?? "").trim() ? 1 : 0);
  }, 0);

  if (!matchIds.length) {
    return {
      ok: true,
      season: params.season,
      round: params.round,
      round_id: roundId,
      reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
      champion_highlight_user_ids: reigningChampion.champion_highlight_user_ids,
      champion_seasons_by_user_id: reigningChampion.champion_seasons_by_user_id,
      lock_time_utc: lockTimeUtc,
      snapshot_for_time_utc: snapshotForTimeUtc,
      matches: [],
      players: [],
    };
  }

  const { data: tips, error: tErr } = await supabase
    .from("tips")
    .select("user_id, match_id, picked_team")
    .eq("competition_id", competitionId)
    .in("match_id", matchIds);

  if (tErr) {
    throw new Error(tErr.message);
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
        throw new Error(fallback.error.message);
      }
      membershipRows = (fallback.data ?? []) as unknown as MembershipRow[];
    } else if (withPaymentAndTest.error) {
      throw new Error(withPaymentAndTest.error.message);
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
        throw new Error(pErr.message);
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
    throw new Error(oErr.message);
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
  for (const match of matchList) matchById[match.id] = match;

  for (const tip of tipRows) {
    const uid = String(tip.user_id);
    if (!eligibleUserIds.has(uid)) continue;
    const matchId = String(tip.match_id);
    const pickedTeam = String(tip.picked_team ?? "").trim();
    if (!pickedTeam || !matchById[matchId]) continue;

    const match = matchById[matchId];
    const winner = String(match.winner_team ?? "").trim();
    const isFinished = !!winner;

    if (!teamCountByMatch[matchId]) teamCountByMatch[matchId] = {};
    teamCountByMatch[matchId][pickedTeam] = (teamCountByMatch[matchId][pickedTeam] ?? 0) + 1;
    totalTipsByMatch[matchId] = (totalTipsByMatch[matchId] ?? 0) + 1;

    const odds = oddsByMatchId[matchId];
    let pickedOdds = 0;
    if (odds) {
      if (pickedTeam === match.home_team) pickedOdds = Number(odds.home_odds ?? 0);
      else if (pickedTeam === match.away_team) pickedOdds = Number(odds.away_odds ?? 0);
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
    playersById[uid].picks[matchId] = pickedTeam;

    if (isCorrect) {
      playersById[uid].correct_tips += 1;
      playersById[uid].round_score += points;
      playersById[uid].correct_odds_sum += points;
    }
  }

  const matchesOut: MatchResultRow[] = matchList.map((match) => {
    const matchId = match.id;
    const totalTips = totalTipsByMatch[matchId] ?? 0;
    const byTeam = teamCountByMatch[matchId] ?? {};
    const homeCount = byTeam[match.home_team] ?? 0;
    const awayCount = byTeam[match.away_team] ?? 0;
    const homePct = totalTips ? Math.round((homeCount / totalTips) * 100) : 0;
    const awayPct = totalTips ? Math.round((awayCount / totalTips) * 100) : 0;

    return {
      ...match,
      home_odds: oddsByMatchId[matchId]?.home_odds ?? null,
      away_odds: oddsByMatchId[matchId]?.away_odds ?? null,
      total_tips: totalTips,
      tipping: {
        home_team: match.home_team,
        away_team: match.away_team,
        home_count: homeCount,
        away_count: awayCount,
        home_pct: homePct,
        away_pct: awayPct,
      },
    };
  });

  const players: PlayerRoundScore[] = Object.values(playersById)
    .map((player) => {
      const accuracyBase = completedGamesInRound > 0 ? completedGamesInRound : 0;
      const accuracyCorrect = accuracyBase > 0 ? Math.min(player.correct_tips, accuracyBase) : 0;
      const accuracyPct = accuracyBase > 0 ? (accuracyCorrect / accuracyBase) * 100 : 0;
      const avgCorrectOdds =
        player.correct_tips > 0 ? player.correct_odds_sum / player.correct_tips : 0;
      const differenceScore = player.potential_score - player.round_score;
      return {
        user_id: player.user_id,
        display_name: player.display_name,
        payment_status: player.payment_status,
        round_score: player.round_score,
        potential_score: player.potential_score,
        difference_score: differenceScore,
        correct_tips: player.correct_tips,
        total_tips: player.total_tips,
        accuracy_pct: accuracyPct,
        avg_correct_odds: avgCorrectOdds,
        picks: player.picks,
      };
    })
    .sort((a, b) => {
      if (b.round_score !== a.round_score) return b.round_score - a.round_score;
      if (b.correct_tips !== a.correct_tips) return b.correct_tips - a.correct_tips;
      return a.display_name.localeCompare(b.display_name);
    });

  return {
    ok: true,
    season: params.season,
    round: params.round,
    round_id: roundId,
    reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
    champion_highlight_user_ids: reigningChampion.champion_highlight_user_ids,
    champion_seasons_by_user_id: reigningChampion.champion_seasons_by_user_id,
    lock_time_utc: lockTimeUtc,
    snapshot_for_time_utc: snapshotForTimeUtc,
    matches: matchesOut,
    players,
  };
}
