import { pointsForWinningTip } from "./scoring-lock-rules.ts";
import type {
  StatsInsights,
  StatsLeaderboardRow,
  StatsPagePayload,
  StatsRankTrendSeries,
  StatsSnapshot,
  TeamStatsRow,
  TeamStatsTotals,
} from "./stats-types.ts";

export type StatsScoredMatch = {
  id: string;
  round_number: number;
  commence_time_utc: string | null;
  home_team_normalized: string;
  away_team_normalized: string;
  winner_team_normalized: string;
  home_odds: number;
  away_odds: number;
  winner_odds: number;
};

export type StatsTipRow = {
  match_id: string;
  user_id: string;
  picked_team: string | null;
};

export type StatsSeasonBaseData = {
  season: number;
  competition_id: string | null;
  leaderboard_rows: StatsLeaderboardRow[];
  scored_rounds: number[];
  rank_trends: StatsRankTrendSeries[];
  season_teams: string[];
  scored_matches: StatsScoredMatch[];
  all_tips: StatsTipRow[];
};

type RoundPerformance = {
  round_number: number;
  score: number;
  movement: number;
};

const TEAM_NAME_ALIASES: Record<string, string> = {
  adelaide: "Adelaide",
  "adelaide crows": "Adelaide",
  "brisbane lions": "Brisbane Lions",
  carlton: "Carlton",
  "carlton blues": "Carlton",
  collingwood: "Collingwood",
  "collingwood magpies": "Collingwood",
  essendon: "Essendon",
  "essendon bombers": "Essendon",
  fremantle: "Fremantle",
  "fremantle dockers": "Fremantle",
  geelong: "Geelong",
  "geelong cats": "Geelong",
  "gold coast": "Gold Coast",
  "gold coast suns": "Gold Coast",
  gws: "Greater Western Sydney",
  "gws giants": "Greater Western Sydney",
  "greater western sydney": "Greater Western Sydney",
  "greater western sydney giants": "Greater Western Sydney",
  hawthorn: "Hawthorn",
  "hawthorn hawks": "Hawthorn",
  melbourne: "Melbourne",
  "melbourne demons": "Melbourne",
  "north melbourne": "North Melbourne",
  kangaroos: "North Melbourne",
  "north melbourne kangaroos": "North Melbourne",
  "port adelaide": "Port Adelaide",
  "port adelaide power": "Port Adelaide",
  richmond: "Richmond",
  "richmond tigers": "Richmond",
  "st kilda": "St Kilda",
  "st kilda saints": "St Kilda",
  sydney: "Sydney",
  "sydney swans": "Sydney",
  "west coast": "West Coast",
  "west coast eagles": "West Coast",
  "western bulldogs": "Western Bulldogs",
};

export const EMPTY_TEAM_TOTALS: TeamStatsTotals = {
  tipped: 0,
  correct: 0,
  incorrect: 0,
  total_points: 0,
};

export function createEmptyStatsInsights(): StatsInsights {
  return {
    current_streak: 0,
    longest_streak: 0,
    underdog_record: { tips: 0, correct: 0, incorrect: 0, points: 0 },
    favourite_record: { tips: 0, correct: 0, incorrect: 0, points: 0 },
    risk_profile: { avg_tipped_odds: 0, comp_avg_tipped_odds: 0, delta_vs_comp: 0 },
    contrarian_edge: {
      contrarian_picks: 0,
      rounds_with_contrarian_pick: 0,
      net_points_delta: 0,
      gained_rounds: 0,
      lost_rounds: 0,
    },
    best_round: null,
    worst_round: null,
    points_vs_comp_avg: { user_points: 0, comp_avg_points: 0, delta: 0 },
    missed_tips_impact: { missed_tips: 0, potential_points_lost: 0 },
  };
}

export function round2(value: number) {
  return Number(Number(value ?? 0).toFixed(2));
}

function round1(value: number) {
  return Number(Number(value ?? 0).toFixed(1));
}

export function normalizeStatsTeamName(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return "";
  return TEAM_NAME_ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

function toStatsSnapshot(row: StatsLeaderboardRow | null): StatsSnapshot | null {
  if (!row) return null;
  return {
    rank: Number(row.rank ?? 0),
    total_points: round2(Number(row.total_points ?? 0)),
    accuracy_pct: Number(row.accuracy_pct ?? 0),
    behind_leader: round2(Number(row.behind_leader ?? 0)),
    movement: Number(row.movement ?? 0),
    current_streak: Number(row.current_streak ?? 0),
    correct_tips: Number(row.correct_tips ?? 0),
    tips_submitted: Number(row.tips_submitted ?? 0),
    missed_tips: Number(row.missed_tips ?? 0),
    round_score: round2(Number(row.round_score ?? 0)),
    avg_winning_odds: round2(Number(row.avg_winning_odds ?? 0)),
  };
}

function pickTeamOdds(match: StatsScoredMatch, pickedTeam: string) {
  if (pickedTeam === match.home_team_normalized) return Number(match.home_odds ?? 0);
  if (pickedTeam === match.away_team_normalized) return Number(match.away_odds ?? 0);
  return 0;
}

function movementByRoundFromTrend(params: {
  userId: string;
  rankTrends: StatsRankTrendSeries[];
}) {
  const series = params.rankTrends.find((row) => row.user_id === params.userId);
  const out = new Map<number, number>();
  if (!series?.points?.length) return out;

  const sorted = [...series.points].sort((a, b) => a.round_number - b.round_number);
  let prevRank: number | null = null;
  for (const point of sorted) {
    const movement = prevRank === null ? 0 : prevRank - Number(point.rank ?? 0);
    out.set(Number(point.round_number), movement);
    prevRank = Number(point.rank ?? 0);
  }
  return out;
}

function pickBestRound(rows: RoundPerformance[]) {
  if (!rows.length) return null;
  return rows.reduce((best, row) => {
    if (row.score > best.score) return row;
    if (row.score === best.score && row.movement > best.movement) return row;
    if (row.score === best.score && row.movement === best.movement && row.round_number < best.round_number) {
      return row;
    }
    return best;
  }, rows[0]);
}

function pickWorstRound(rows: RoundPerformance[]) {
  if (!rows.length) return null;
  return rows.reduce((worst, row) => {
    if (row.score < worst.score) return row;
    if (row.score === worst.score && row.movement < worst.movement) return row;
    if (row.score === worst.score && row.movement === worst.movement && row.round_number > worst.round_number) {
      return row;
    }
    return worst;
  }, rows[0]);
}

function buildTeamRows(params: {
  userId: string;
  seasonTeams: string[];
  scoredMatches: StatsScoredMatch[];
  allTips: StatsTipRow[];
}) {
  const scoredMatchesById = new Map(params.scoredMatches.map((match) => [String(match.id), match]));
  const statsByTeam = new Map<
    string,
    {
      tipped_count: number;
      correct_count: number;
      incorrect_count: number;
      total_points: number;
    }
  >();

  for (const team of params.seasonTeams) {
    statsByTeam.set(team, {
      tipped_count: 0,
      correct_count: 0,
      incorrect_count: 0,
      total_points: 0,
    });
  }

  for (const tip of params.allTips) {
    if (String(tip.user_id) !== params.userId) continue;

    const pickedTeam = normalizeStatsTeamName(tip.picked_team);
    if (!pickedTeam) continue;

    const match = scoredMatchesById.get(String(tip.match_id));
    if (!match) continue;

    if (!statsByTeam.has(pickedTeam)) {
      statsByTeam.set(pickedTeam, {
        tipped_count: 0,
        correct_count: 0,
        incorrect_count: 0,
        total_points: 0,
      });
    }

    const teamStats = statsByTeam.get(pickedTeam)!;
    teamStats.tipped_count += 1;

    const correct = pickedTeam === match.winner_team_normalized;
    if (correct) {
      const points = pointsForWinningTip({
        pickedTeam,
        winnerTeam: match.winner_team_normalized,
        homeTeam: match.home_team_normalized,
        awayTeam: match.away_team_normalized,
        homeOdds: Number(match.home_odds ?? 0),
        awayOdds: Number(match.away_odds ?? 0),
      });
      teamStats.correct_count += 1;
      teamStats.total_points += Number(points ?? 0);
    } else {
      teamStats.incorrect_count += 1;
    }
  }

  const rows: TeamStatsRow[] = Array.from(statsByTeam.entries())
    .map(([team, value]) => {
      const tipped = Number(value.tipped_count ?? 0);
      const correct = Number(value.correct_count ?? 0);
      const points = Number(value.total_points ?? 0);
      const incorrect = Number(value.incorrect_count ?? 0);
      const accuracy = tipped > 0 ? (correct / tipped) * 100 : 0;
      const avgPerTip = tipped > 0 ? points / tipped : 0;
      const avgPerCorrect = correct > 0 ? points / correct : 0;

      return {
        team,
        tipped_count: tipped,
        correct_count: correct,
        incorrect_count: incorrect,
        accuracy_pct: round1(accuracy),
        total_points: round2(points),
        avg_points_per_tip: round2(avgPerTip),
        avg_points_per_correct: round2(avgPerCorrect),
      };
    })
    .sort((a, b) => {
      if (b.tipped_count !== a.tipped_count) return b.tipped_count - a.tipped_count;
      if (b.total_points !== a.total_points) return b.total_points - a.total_points;
      return a.team.localeCompare(b.team, "en", { sensitivity: "base" });
    });

  const totals = rows.reduce(
    (acc, row) => {
      acc.tipped += row.tipped_count;
      acc.correct += row.correct_count;
      acc.incorrect += row.incorrect_count;
      acc.total_points += row.total_points;
      return acc;
    },
    { ...EMPTY_TEAM_TOTALS }
  );

  return {
    rows,
    totals: {
      tipped: totals.tipped,
      correct: totals.correct,
      incorrect: totals.incorrect,
      total_points: round2(totals.total_points),
    },
  };
}

export function buildStatsPayloadFromBase(params: {
  base: StatsSeasonBaseData;
  userId: string;
}): StatsPagePayload {
  const { base, userId } = params;
  const myLeaderboardRow = base.leaderboard_rows.find((row) => row.user_id === userId) ?? null;
  const snapshot = toStatsSnapshot(myLeaderboardRow);
  const teamStats = buildTeamRows({
    userId,
    seasonTeams: base.season_teams,
    scoredMatches: base.scored_matches,
    allTips: base.all_tips,
  });

  if (!base.competition_id) {
    return {
      season: base.season,
      competition_id: null,
      snapshot: null,
      insights: createEmptyStatsInsights(),
      team_rows: [],
      team_totals: { ...EMPTY_TEAM_TOTALS },
    };
  }

  const allPickedOdds: number[] = [];
  const myPickByMatchId = new Map<string, string>();
  const majorityByMatchId = new Map<string, string | null>();
  const majorityPointsByMatchId = new Map<string, number>();
  const picksByMatch = new Map<string, { home: number; away: number }>();
  const scoredByMatchId = new Map(base.scored_matches.map((match) => [String(match.id), match]));

  for (const match of base.scored_matches) {
    picksByMatch.set(String(match.id), { home: 0, away: 0 });
  }

  for (const tip of base.all_tips) {
    const matchId = String(tip.match_id);
    const match = scoredByMatchId.get(matchId);
    if (!match) continue;

    const picked = normalizeStatsTeamName(tip.picked_team);
    if (!picked) continue;
    if (picked !== match.home_team_normalized && picked !== match.away_team_normalized) continue;

    const pickedOdds = pickTeamOdds(match, picked);
    if (pickedOdds > 0) allPickedOdds.push(pickedOdds);

    const counts = picksByMatch.get(matchId);
    if (counts) {
      if (picked === match.home_team_normalized) counts.home += 1;
      if (picked === match.away_team_normalized) counts.away += 1;
    }

    if (String(tip.user_id) === userId && !myPickByMatchId.has(matchId)) {
      myPickByMatchId.set(matchId, picked);
    }
  }

  for (const match of base.scored_matches) {
    const counts = picksByMatch.get(String(match.id)) ?? { home: 0, away: 0 };
    const majorityTeam =
      counts.home > counts.away
        ? match.home_team_normalized
        : counts.away > counts.home
          ? match.away_team_normalized
          : null;

    majorityByMatchId.set(String(match.id), majorityTeam);
    if (!majorityTeam) {
      majorityPointsByMatchId.set(String(match.id), 0);
      continue;
    }

    const majorityPoints = pointsForWinningTip({
      pickedTeam: majorityTeam,
      winnerTeam: match.winner_team_normalized,
      homeTeam: match.home_team_normalized,
      awayTeam: match.away_team_normalized,
      homeOdds: Number(match.home_odds ?? 0),
      awayOdds: Number(match.away_odds ?? 0),
    });
    majorityPointsByMatchId.set(String(match.id), Number(majorityPoints ?? 0));
  }

  let currentStreak = 0;
  for (let i = base.scored_matches.length - 1; i >= 0; i -= 1) {
    const match = base.scored_matches[i];
    const picked = myPickByMatchId.get(String(match.id));
    if (!picked) break;
    if (picked === match.winner_team_normalized) {
      currentStreak += 1;
      continue;
    }
    break;
  }

  let longestStreak = 0;
  let runningStreak = 0;
  let userPickedOddsTotal = 0;
  let userPickedOddsCount = 0;
  let missedTips = 0;
  let potentialPointsLost = 0;

  let underdogTips = 0;
  let underdogCorrect = 0;
  let underdogIncorrect = 0;
  let underdogPoints = 0;

  let favouriteTips = 0;
  let favouriteCorrect = 0;
  let favouriteIncorrect = 0;
  let favouritePoints = 0;

  let contrarianPicks = 0;
  const contrarianEdgeByRound = new Map<number, number>();
  const roundScoreByRound = new Map<number, number>();

  for (const match of base.scored_matches) {
    const matchId = String(match.id);
    const pickedTeam = myPickByMatchId.get(matchId);
    const roundNo = Number(match.round_number ?? 0);

    if (!pickedTeam) {
      missedTips += 1;
      potentialPointsLost += Number(match.winner_odds ?? 0);
      runningStreak = 0;
      continue;
    }

    const pickedOdds = pickTeamOdds(match, pickedTeam);
    if (pickedOdds > 0) {
      userPickedOddsTotal += pickedOdds;
      userPickedOddsCount += 1;
    }

    const userPoints = pointsForWinningTip({
      pickedTeam,
      winnerTeam: match.winner_team_normalized,
      homeTeam: match.home_team_normalized,
      awayTeam: match.away_team_normalized,
      homeOdds: Number(match.home_odds ?? 0),
      awayOdds: Number(match.away_odds ?? 0),
    });

    if (pickedTeam === match.winner_team_normalized) {
      runningStreak += 1;
    } else {
      runningStreak = 0;
    }
    if (runningStreak > longestStreak) longestStreak = runningStreak;

    roundScoreByRound.set(roundNo, Number(roundScoreByRound.get(roundNo) ?? 0) + Number(userPoints ?? 0));

    if (pickedOdds >= 2) {
      underdogTips += 1;
      if (pickedTeam === match.winner_team_normalized) {
        underdogCorrect += 1;
        underdogPoints += Number(userPoints ?? 0);
      } else {
        underdogIncorrect += 1;
      }
    } else {
      favouriteTips += 1;
      if (pickedTeam === match.winner_team_normalized) {
        favouriteCorrect += 1;
        favouritePoints += Number(userPoints ?? 0);
      } else {
        favouriteIncorrect += 1;
      }
    }

    const majorityTeam = majorityByMatchId.get(matchId) ?? null;
    if (majorityTeam && pickedTeam !== majorityTeam) {
      contrarianPicks += 1;
      const majorityPoints = Number(majorityPointsByMatchId.get(matchId) ?? 0);
      const delta = Number(userPoints ?? 0) - majorityPoints;
      contrarianEdgeByRound.set(roundNo, Number(contrarianEdgeByRound.get(roundNo) ?? 0) + delta);
    }
  }

  const scoredRoundsSorted = Array.from(new Set(base.scored_rounds.map((roundNo) => Number(roundNo)))).sort(
    (a, b) => a - b
  );
  const movementByRound = movementByRoundFromTrend({
    userId,
    rankTrends: base.rank_trends,
  });

  const roundPerformanceRows: RoundPerformance[] = scoredRoundsSorted.map((roundNo) => ({
    round_number: roundNo,
    score: round2(Number(roundScoreByRound.get(roundNo) ?? 0)),
    movement: Number(movementByRound.get(roundNo) ?? 0),
  }));

  const bestRound = pickBestRound(roundPerformanceRows);
  const worstRound = pickWorstRound(roundPerformanceRows);

  const contrarianRoundDeltas = Array.from(contrarianEdgeByRound.values());
  const contrarianNet = contrarianRoundDeltas.reduce((sum, value) => sum + Number(value ?? 0), 0);
  const contrarianGainedRounds = contrarianRoundDeltas.filter((value) => value > 0).length;
  const contrarianLostRounds = contrarianRoundDeltas.filter((value) => value < 0).length;

  const compAvgPoints =
    base.leaderboard_rows.length > 0
      ? base.leaderboard_rows.reduce((sum, row) => sum + Number(row.total_points ?? 0), 0) /
        base.leaderboard_rows.length
      : 0;
  const userPoints = Number(myLeaderboardRow?.total_points ?? 0);

  const userAvgTippedOdds = userPickedOddsCount > 0 ? Number(userPickedOddsTotal / userPickedOddsCount) : 0;
  const compAvgPickedOdds =
    allPickedOdds.length > 0
      ? allPickedOdds.reduce((sum, value) => sum + Number(value ?? 0), 0) / allPickedOdds.length
      : 0;

  return {
    season: base.season,
    competition_id: base.competition_id,
    snapshot,
    insights: {
      current_streak: Number(currentStreak),
      longest_streak: Number(longestStreak),
      underdog_record: {
        tips: Number(underdogTips),
        correct: Number(underdogCorrect),
        incorrect: Number(underdogIncorrect),
        points: round2(Number(underdogPoints)),
      },
      favourite_record: {
        tips: Number(favouriteTips),
        correct: Number(favouriteCorrect),
        incorrect: Number(favouriteIncorrect),
        points: round2(Number(favouritePoints)),
      },
      risk_profile: {
        avg_tipped_odds: round2(Number(userAvgTippedOdds)),
        comp_avg_tipped_odds: round2(Number(compAvgPickedOdds)),
        delta_vs_comp: round2(Number(userAvgTippedOdds - compAvgPickedOdds)),
      },
      contrarian_edge: {
        contrarian_picks: Number(contrarianPicks),
        rounds_with_contrarian_pick: Number(contrarianEdgeByRound.size),
        net_points_delta: round2(Number(contrarianNet)),
        gained_rounds: Number(contrarianGainedRounds),
        lost_rounds: Number(contrarianLostRounds),
      },
      best_round: bestRound
        ? {
            round_number: Number(bestRound.round_number),
            score: round2(Number(bestRound.score)),
            movement: Number(bestRound.movement),
          }
        : null,
      worst_round: worstRound
        ? {
            round_number: Number(worstRound.round_number),
            score: round2(Number(worstRound.score)),
            movement: Number(worstRound.movement),
          }
        : null,
      points_vs_comp_avg: {
        user_points: round2(userPoints),
        comp_avg_points: round2(Number(compAvgPoints)),
        delta: round2(Number(userPoints - compAvgPoints)),
      },
      missed_tips_impact: {
        missed_tips: Number(missedTips),
        potential_points_lost: round2(Number(potentialPointsLost)),
      },
    },
    team_rows: teamStats.rows,
    team_totals: teamStats.totals,
  };
}
