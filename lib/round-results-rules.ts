export type RoundResultsRuleMatch = {
  id: string;
  home_team: string;
  away_team: string;
  winner_team: string | null;
  commence_time_utc?: string;
  venue?: string | null;
  status?: string | null;
};

export type RoundResultsRuleTip = {
  user_id: string;
  match_id: string;
  picked_team: string | null;
};

export type RoundResultsRulePlayer = {
  user_id: string;
  display_name: string;
  payment_status?: string | null;
};

export type RoundResultsRuleOdds = {
  match_id: string;
  home_odds: number | null;
  away_odds: number | null;
};

export type RoundResultsComparablePlayer = {
  display_name: string;
  round_score: number;
  correct_tips: number;
};

export type RoundResultsSnapshotPlayer = {
  user_id: string;
  display_name: string;
  payment_status: string | null;
  round_score: number;
  potential_score: number;
  difference_score: number;
  correct_tips: number;
  total_tips: number;
  accuracy_pct: number;
  avg_correct_odds: number;
  picks: Record<string, string>;
};

export type RoundResultsSnapshotMatch = {
  id: string;
  home_team: string;
  away_team: string;
  winner_team: string | null;
  commence_time_utc: string;
  venue: string | null;
  status: string | null;
  home_odds: number | null;
  away_odds: number | null;
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

function pointsForWinningRoundTip(params: {
  pickedTeam: string;
  winnerTeam: string;
  homeTeam: string;
  awayTeam: string;
  homeOdds: number;
  awayOdds: number;
}) {
  if (!params.pickedTeam || !params.winnerTeam || params.pickedTeam !== params.winnerTeam) {
    return 0;
  }
  if (params.winnerTeam === params.homeTeam) return Number(params.homeOdds ?? 0);
  if (params.winnerTeam === params.awayTeam) return Number(params.awayOdds ?? 0);
  return 0;
}

export function roundResultsPlayerComparator(
  a: RoundResultsComparablePlayer,
  b: RoundResultsComparablePlayer
) {
  if (b.round_score !== a.round_score) return b.round_score - a.round_score;
  if (b.correct_tips !== a.correct_tips) return b.correct_tips - a.correct_tips;
  return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
}

export function pickFirstOddsByMatch(
  rows: RoundResultsRuleOdds[]
): Record<string, { home_odds: number; away_odds: number }> {
  const oddsByMatchId: Record<string, { home_odds: number; away_odds: number }> = {};
  rows.forEach((row) => {
    const matchId = String(row.match_id);
    if (oddsByMatchId[matchId]) return;
    oddsByMatchId[matchId] = {
      home_odds: Number(row.home_odds ?? 0),
      away_odds: Number(row.away_odds ?? 0),
    };
  });
  return oddsByMatchId;
}

export function buildRoundResultsSnapshot(params: {
  matches: RoundResultsRuleMatch[];
  tips: RoundResultsRuleTip[];
  eligiblePlayers: RoundResultsRulePlayer[];
  oddsByMatchId: Record<string, { home_odds: number; away_odds: number }>;
}) {
  const matchById: Record<string, RoundResultsRuleMatch> = {};
  params.matches.forEach((match) => {
    matchById[match.id] = match;
  });

  const eligiblePlayerById = new Map(
    params.eligiblePlayers.map((player) => [player.user_id, player])
  );

  const completedGamesInRound = params.matches.reduce((acc, match) => {
    return acc + (String(match.winner_team ?? "").trim() ? 1 : 0);
  }, 0);

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

  for (const tip of params.tips) {
    const userId = String(tip.user_id);
    const player = eligiblePlayerById.get(userId);
    if (!player) continue;

    const matchId = String(tip.match_id);
    const match = matchById[matchId];
    if (!match) continue;

    const pickedTeam = String(tip.picked_team ?? "").trim();
    if (!pickedTeam) continue;

    if (!teamCountByMatch[matchId]) teamCountByMatch[matchId] = {};
    teamCountByMatch[matchId][pickedTeam] = (teamCountByMatch[matchId][pickedTeam] ?? 0) + 1;
    totalTipsByMatch[matchId] = (totalTipsByMatch[matchId] ?? 0) + 1;

    if (!playersById[userId]) {
      playersById[userId] = {
        user_id: userId,
        display_name: player.display_name,
        payment_status: player.payment_status ?? null,
        round_score: 0,
        potential_score: 0,
        correct_tips: 0,
        total_tips: 0,
        correct_odds_sum: 0,
        picks: {},
      };
    }

    const odds = params.oddsByMatchId[matchId];
    const homeOdds = Number(odds?.home_odds ?? 0);
    const awayOdds = Number(odds?.away_odds ?? 0);
    let pickedOdds = 0;
    if (pickedTeam === match.home_team) pickedOdds = homeOdds;
    else if (pickedTeam === match.away_team) pickedOdds = awayOdds;

    playersById[userId].total_tips += 1;
    playersById[userId].potential_score += pickedOdds;
    playersById[userId].picks[matchId] = pickedTeam;

    const points = pointsForWinningRoundTip({
      pickedTeam,
      winnerTeam: String(match.winner_team ?? "").trim(),
      homeTeam: match.home_team,
      awayTeam: match.away_team,
      homeOdds,
      awayOdds,
    });

    if (points > 0) {
      playersById[userId].correct_tips += 1;
      playersById[userId].round_score += points;
      playersById[userId].correct_odds_sum += points;
    }
  }

  const matches: RoundResultsSnapshotMatch[] = params.matches.map((match) => {
    const matchId = match.id;
    const totalTips = totalTipsByMatch[matchId] ?? 0;
    const byTeam = teamCountByMatch[matchId] ?? {};
    const homeCount = byTeam[match.home_team] ?? 0;
    const awayCount = byTeam[match.away_team] ?? 0;
    const homePct = totalTips ? Math.round((homeCount / totalTips) * 100) : 0;
    const awayPct = totalTips ? Math.round((awayCount / totalTips) * 100) : 0;

    return {
      id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      winner_team: match.winner_team ?? null,
      commence_time_utc: match.commence_time_utc ?? "",
      venue: match.venue ?? null,
      status: match.status ?? null,
      home_odds: params.oddsByMatchId[matchId]?.home_odds ?? null,
      away_odds: params.oddsByMatchId[matchId]?.away_odds ?? null,
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

  const players: RoundResultsSnapshotPlayer[] = Object.values(playersById)
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
    .sort(roundResultsPlayerComparator);

  return {
    matches,
    players,
  };
}
