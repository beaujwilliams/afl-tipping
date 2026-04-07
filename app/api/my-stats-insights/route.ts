import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getBearer } from "@/lib/admin-auth";
import {
  getLeaderboardSnapshot,
  type LeaderboardRow as SnapshotRow,
} from "@/lib/leaderboard-snapshot";
import { pointsForWinningTip } from "@/lib/scoring-lock-rules";
import { createClient, createServiceClient } from "@/lib/supabase-server";

type RoundRow = {
  id: string;
  competition_id: string;
  round_number: number;
  odds_snapshot_for_time_utc: string | null;
};

type MatchRow = {
  id: string;
  round_id: string;
  home_team: string;
  away_team: string;
  winner_team: string | null;
  commence_time_utc: string | null;
};

type OddsRow = {
  match_id: string;
  home_odds: number | null;
  away_odds: number | null;
  snapshot_for_time_utc: string | null;
  captured_at_utc: string;
};

type TipRow = {
  match_id: string;
  user_id: string;
  picked_team: string | null;
};

type RoundPerformance = {
  round_number: number;
  score: number;
  movement: number;
};

type ScoredMatch = MatchRow & {
  round_number: number;
  home_team_normalized: string;
  away_team_normalized: string;
  winner_team_normalized: string;
  home_odds: number;
  away_odds: number;
  winner_odds: number;
};

const SUPABASE_PAGE_SIZE = 1000;

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

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function round2(value: number) {
  return Number(Number(value ?? 0).toFixed(2));
}

function normalizeTeamName(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return "";
  return TEAM_NAME_ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

function pickTeamOdds(match: ScoredMatch, pickedTeam: string) {
  if (pickedTeam === match.home_team_normalized) return Number(match.home_odds ?? 0);
  if (pickedTeam === match.away_team_normalized) return Number(match.away_odds ?? 0);
  return 0;
}

async function readTipsForScoredMatches(params: {
  supabase: ReturnType<typeof createServiceClient>;
  competitionId: string;
  scoredMatchIds: string[];
}) {
  if (!params.scoredMatchIds.length) return [] as TipRow[];

  const out: TipRow[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;

    const { data, error } = await params.supabase
      .from("tips")
      .select("match_id, user_id, picked_team")
      .eq("competition_id", params.competitionId)
      .in("match_id", params.scoredMatchIds)
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read tips: ${error.message}`);
    }

    const batch = (data ?? []) as TipRow[];
    out.push(...batch);

    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return out;
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

function movementByRoundFromTrend(params: {
  userId: string;
  rankTrends: Array<{ user_id: string; points: Array<{ round_number: number; rank: number }> }>;
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

    const leaderboard = await getLeaderboardSnapshot({ season, preferCached: true });
    const competitionId = String(leaderboard.competition_id ?? "").trim();
    const mySnapshot = (leaderboard.rows ?? []).find((row) => row.user_id === user.id) ?? null;

    if (!competitionId) {
      return NextResponse.json({
        ok: true,
        season,
        competition_id: null,
        snapshot: null,
        insights: {
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
        },
      });
    }

    const supabase = createServiceClient();
    const { data: rounds, error: roundsErr } = await supabase
      .from("rounds")
      .select("id, competition_id, round_number, odds_snapshot_for_time_utc")
      .eq("season", season)
      .eq("competition_id", competitionId)
      .order("round_number", { ascending: true });

    if (roundsErr) {
      return NextResponse.json(
        { error: "Failed to read rounds", details: roundsErr.message },
        { status: 500 }
      );
    }

    const roundRows = (rounds ?? []) as RoundRow[];
    const roundById = new Map(roundRows.map((row) => [String(row.id), row]));
    const roundIds = roundRows.map((row) => String(row.id));

    if (!roundIds.length) {
      return NextResponse.json({
        ok: true,
        season,
        competition_id: competitionId,
        snapshot: mySnapshot,
        insights: {
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
        },
      });
    }

    const { data: matches, error: matchesErr } = await supabase
      .from("matches")
      .select("id, round_id, home_team, away_team, winner_team, commence_time_utc")
      .in("round_id", roundIds)
      .order("commence_time_utc", { ascending: true });

    if (matchesErr) {
      return NextResponse.json(
        { error: "Failed to read matches", details: matchesErr.message },
        { status: 500 }
      );
    }

    const matchRows = (matches ?? []) as MatchRow[];

    const lockedSnapshotByMatchId = new Map<string, string>();
    const candidateMatchIds: string[] = [];
    for (const match of matchRows) {
      const round = roundById.get(String(match.round_id));
      if (!round) continue;

      const winner = String(match.winner_team ?? "").trim();
      const snapshot = String(round.odds_snapshot_for_time_utc ?? "").trim();
      if (!winner || !snapshot) continue;

      const matchId = String(match.id);
      candidateMatchIds.push(matchId);
      lockedSnapshotByMatchId.set(matchId, snapshot);
    }

    const oddsByMatchId = new Map<string, { home_odds: number; away_odds: number }>();
    if (candidateMatchIds.length > 0) {
      const uniqueSnapshots = Array.from(new Set(Array.from(lockedSnapshotByMatchId.values())));
      const { data: odds, error: oddsErr } = await supabase
        .from("match_odds")
        .select("match_id, home_odds, away_odds, snapshot_for_time_utc, captured_at_utc")
        .eq("competition_id", competitionId)
        .in("match_id", candidateMatchIds)
        .in("snapshot_for_time_utc", uniqueSnapshots)
        .order("captured_at_utc", { ascending: false });

      if (oddsErr) {
        return NextResponse.json(
          { error: "Failed to read match odds", details: oddsErr.message },
          { status: 500 }
        );
      }

      for (const row of (odds ?? []) as OddsRow[]) {
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
    for (const match of matchRows) {
      const matchId = String(match.id);
      const winnerTeamNormalized = normalizeTeamName(match.winner_team);
      if (!winnerTeamNormalized) continue;

      const odds = oddsByMatchId.get(matchId);
      if (!odds) continue;

      const round = roundById.get(String(match.round_id));
      if (!round) continue;

      const homeTeamNormalized = normalizeTeamName(match.home_team);
      const awayTeamNormalized = normalizeTeamName(match.away_team);
      const winnerOdds =
        winnerTeamNormalized === homeTeamNormalized
          ? Number(odds.home_odds ?? 0)
          : winnerTeamNormalized === awayTeamNormalized
          ? Number(odds.away_odds ?? 0)
          : 0;

      scoredMatches.push({
        ...match,
        round_number: Number(round.round_number ?? 0),
        home_team_normalized: homeTeamNormalized,
        away_team_normalized: awayTeamNormalized,
        winner_team_normalized: winnerTeamNormalized,
        home_odds: Number(odds.home_odds ?? 0),
        away_odds: Number(odds.away_odds ?? 0),
        winner_odds: Number(winnerOdds ?? 0),
      });
    }

    scoredMatches.sort((a, b) => {
      if (a.round_number !== b.round_number) return a.round_number - b.round_number;
      const aMs = a.commence_time_utc ? new Date(a.commence_time_utc).getTime() : NaN;
      const bMs = b.commence_time_utc ? new Date(b.commence_time_utc).getTime() : NaN;
      if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return aMs - bMs;
      return String(a.id).localeCompare(String(b.id));
    });

    const scoredMatchIds = scoredMatches.map((m) => String(m.id));
    const scoredByMatchId = new Map(scoredMatches.map((m) => [String(m.id), m]));

    let allTips: TipRow[] = [];
    try {
      allTips = await readTipsForScoredMatches({
        supabase,
        competitionId,
        scoredMatchIds,
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json(
        { error: "Failed to read tips", details },
        { status: 500 }
      );
    }

    const myPickByMatchId = new Map<string, string>();
    const allPickedOdds: number[] = [];
    const majorityByMatchId = new Map<string, string | null>();
    const majorityPointsByMatchId = new Map<string, number>();

    const picksByMatch = new Map<string, { home: number; away: number }>();
    for (const match of scoredMatches) {
      picksByMatch.set(String(match.id), { home: 0, away: 0 });
    }

    for (const tip of allTips) {
      const matchId = String(tip.match_id);
      const match = scoredByMatchId.get(matchId);
      if (!match) continue;

      const picked = normalizeTeamName(tip.picked_team);
      if (!picked) continue;
      if (picked !== match.home_team_normalized && picked !== match.away_team_normalized) continue;

      const pickedOdds = pickTeamOdds(match, picked);
      if (pickedOdds > 0) allPickedOdds.push(pickedOdds);

      const counts = picksByMatch.get(matchId);
      if (counts) {
        if (picked === match.home_team_normalized) counts.home += 1;
        if (picked === match.away_team_normalized) counts.away += 1;
      }

      if (String(tip.user_id) === user.id && !myPickByMatchId.has(matchId)) {
        myPickByMatchId.set(matchId, picked);
      }
    }

    for (const match of scoredMatches) {
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
    for (let i = scoredMatches.length - 1; i >= 0; i -= 1) {
      const match = scoredMatches[i];
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
    for (const match of scoredMatches) {
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

    const scoredRoundsSorted = Array.from(
      new Set((leaderboard.scored_rounds ?? []).map((roundNo) => Number(roundNo)))
    ).sort((a, b) => a - b);

    const movementByRound = movementByRoundFromTrend({
      userId: user.id,
      rankTrends: leaderboard.rank_trends ?? [],
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
      leaderboard.rows.length > 0
        ? leaderboard.rows.reduce((sum, row) => sum + Number(row.total_points ?? 0), 0) /
          leaderboard.rows.length
        : 0;
    const userPoints = Number(mySnapshot?.total_points ?? 0);

    const userAvgTippedOdds =
      userPickedOddsCount > 0 ? Number(userPickedOddsTotal / userPickedOddsCount) : 0;
    const compAvgPickedOdds =
      allPickedOdds.length > 0
        ? allPickedOdds.reduce((sum, value) => sum + Number(value ?? 0), 0) / allPickedOdds.length
        : 0;

    return NextResponse.json({
      ok: true,
      season,
      competition_id: competitionId,
      snapshot: mySnapshot as SnapshotRow | null,
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
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load my stats insights", details },
      { status: 500 }
    );
  }
}
