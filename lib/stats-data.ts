import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import {
  getLeaderboardSnapshot,
  type LeaderboardResponse,
  type LeaderboardRow,
  type LeaderboardTrendSeries,
} from "@/lib/leaderboard-snapshot";
import { createServiceClient } from "@/lib/supabase-server";
import {
  buildStatsPayloadFromBase,
  normalizeStatsTeamName,
  type StatsScoredMatch,
  type StatsSeasonBaseData,
  type StatsTipRow,
} from "@/lib/stats-rules";

export { createEmptyStatsInsights, EMPTY_TEAM_TOTALS } from "@/lib/stats-rules";

const SUPABASE_PAGE_SIZE = 1000;
const STATS_SEASON_BASE_CACHE_TAG = "stats-season-base-v1";

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

async function readTipsForScoredMatches(params: {
  competitionId: string;
  scoredMatchIds: string[];
}) {
  if (!params.scoredMatchIds.length) return [] as StatsTipRow[];

  const supabase = createServiceClient();
  const out: StatsTipRow[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from("tips")
      .select("match_id, user_id, picked_team")
      .eq("competition_id", params.competitionId)
      .in("match_id", params.scoredMatchIds)
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read tips: ${error.message}`);
    }

    const batch = (data ?? []) as StatsTipRow[];
    out.push(...batch);

    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return out;
}

function mapLeaderboardRows(rows: LeaderboardRow[]) {
  return (rows ?? []).map((row) => ({
    user_id: String(row.user_id),
    display_name: String(row.display_name ?? ""),
    payment_status: row.payment_status ?? null,
    rank: Number(row.rank ?? 0),
    total_points: Number(row.total_points ?? 0),
    correct_tips: Number(row.correct_tips ?? 0),
    tips_submitted: Number(row.tips_submitted ?? 0),
    missed_tips: Number(row.missed_tips ?? 0),
    accuracy_pct: Number(row.accuracy_pct ?? 0),
    round_score: Number(row.round_score ?? 0),
    movement: Number(row.movement ?? 0),
    behind_leader: Number(row.behind_leader ?? 0),
    current_streak: Number(row.current_streak ?? 0),
    avg_winning_odds: Number(row.avg_winning_odds ?? 0),
  }));
}

function mapRankTrends(trends: LeaderboardTrendSeries[]) {
  return (trends ?? []).map((series) => ({
    user_id: String(series.user_id),
    points: (series.points ?? []).map((point) => ({
      round_number: Number(point.round_number ?? 0),
      rank: Number(point.rank ?? 0),
    })),
  }));
}

function buildStatsBaseFromLeaderboard(params: {
  season: number;
  leaderboard: LeaderboardResponse;
  seasonTeams: string[];
  scoredMatches: StatsScoredMatch[];
  allTips: StatsTipRow[];
}): StatsSeasonBaseData {
  return {
    season: params.season,
    competition_id: String(params.leaderboard.competition_id ?? "").trim() || null,
    leaderboard_rows: mapLeaderboardRows(params.leaderboard.rows ?? []),
    scored_rounds: (params.leaderboard.scored_rounds ?? []).map((value) => Number(value ?? 0)),
    rank_trends: mapRankTrends(params.leaderboard.rank_trends ?? []),
    season_teams: params.seasonTeams,
    scored_matches: params.scoredMatches,
    all_tips: params.allTips,
  };
}

const loadCachedStatsSeasonBase = unstable_cache(
  async (season: number): Promise<StatsSeasonBaseData> => {
    const leaderboard = await getLeaderboardSnapshot({ season, preferCached: true });
    const competitionId = String(leaderboard.competition_id ?? "").trim();

    if (!competitionId) {
      return buildStatsBaseFromLeaderboard({
        season,
        leaderboard,
        seasonTeams: [],
        scoredMatches: [],
        allTips: [],
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
      throw new Error(`Failed to read rounds: ${roundsErr.message}`);
    }

    const roundRows = (rounds ?? []) as RoundRow[];
    const roundById = new Map(roundRows.map((row) => [String(row.id), row]));
    const roundIds = roundRows.map((row) => String(row.id));

    if (!roundIds.length) {
      return buildStatsBaseFromLeaderboard({
        season,
        leaderboard,
        seasonTeams: [],
        scoredMatches: [],
        allTips: [],
      });
    }

    const { data: matches, error: matchesErr } = await supabase
      .from("matches")
      .select("id, round_id, home_team, away_team, winner_team, commence_time_utc")
      .in("round_id", roundIds)
      .order("commence_time_utc", { ascending: true });

    if (matchesErr) {
      throw new Error(`Failed to read matches: ${matchesErr.message}`);
    }

    const matchRows = (matches ?? []) as MatchRow[];
    const seasonTeams = Array.from(
      new Set(
        matchRows
          .flatMap((match) => [normalizeStatsTeamName(match.home_team), normalizeStatsTeamName(match.away_team)])
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

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
        throw new Error(`Failed to read match odds: ${oddsErr.message}`);
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

    const scoredMatches: StatsScoredMatch[] = [];
    for (const match of matchRows) {
      const matchId = String(match.id);
      const winnerTeamNormalized = normalizeStatsTeamName(match.winner_team);
      if (!winnerTeamNormalized) continue;

      const odds = oddsByMatchId.get(matchId);
      if (!odds) continue;

      const round = roundById.get(String(match.round_id));
      if (!round) continue;

      const homeTeamNormalized = normalizeStatsTeamName(match.home_team);
      const awayTeamNormalized = normalizeStatsTeamName(match.away_team);
      const winnerOdds =
        winnerTeamNormalized === homeTeamNormalized
          ? Number(odds.home_odds ?? 0)
          : winnerTeamNormalized === awayTeamNormalized
            ? Number(odds.away_odds ?? 0)
            : 0;

      scoredMatches.push({
        id: matchId,
        round_number: Number(round.round_number ?? 0),
        commence_time_utc: match.commence_time_utc ?? null,
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

    const allTips = await readTipsForScoredMatches({
      competitionId,
      scoredMatchIds: scoredMatches.map((match) => String(match.id)),
    });

    return buildStatsBaseFromLeaderboard({
      season,
      leaderboard,
      seasonTeams,
      scoredMatches,
      allTips,
    });
  },
  ["stats-season-base-v1"],
  { revalidate: 60, tags: [STATS_SEASON_BASE_CACHE_TAG] }
);

export async function getStatsPagePayload(params: { season: number; userId: string }) {
  const base = await loadCachedStatsSeasonBase(params.season);
  return buildStatsPayloadFromBase({ base, userId: params.userId });
}

export function invalidateStatsSeasonBaseCache() {
  revalidateTag(STATS_SEASON_BASE_CACHE_TAG, "max");
}
