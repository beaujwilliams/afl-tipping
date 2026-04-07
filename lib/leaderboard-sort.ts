export type LeaderboardSortKey =
  | "rank"
  | "display_name"
  | "total_points"
  | "correct_tips"
  | "accuracy_pct"
  | "round_score"
  | "movement"
  | "behind_leader"
  | "current_streak"
  | "avg_winning_odds";

export type LeaderboardSortDirection = "asc" | "desc";

type NumericSortKey = Exclude<LeaderboardSortKey, "display_name">;

export type LeaderboardSortRow = {
  user_id: string;
  display_name: string;
  rank: number;
  total_points: number;
  correct_tips: number;
  accuracy_pct: number;
  round_score: number;
  movement: number;
  behind_leader: number;
  current_streak: number;
  avg_winning_odds: number;
};

export const DEFAULT_LEADERBOARD_SORT_KEY: LeaderboardSortKey = "total_points";
export const DEFAULT_LEADERBOARD_SORT_DIRECTION: LeaderboardSortDirection = "desc";

export const DEFAULT_LEADERBOARD_SORT_DIR: Record<
  LeaderboardSortKey,
  LeaderboardSortDirection
> = {
  rank: "asc",
  display_name: "asc",
  total_points: "desc",
  correct_tips: "desc",
  accuracy_pct: "desc",
  round_score: "desc",
  movement: "desc",
  behind_leader: "asc",
  current_streak: "desc",
  avg_winning_odds: "desc",
};

function compareLeaderboardRankFields(
  a: Pick<
    LeaderboardSortRow,
    "display_name" | "total_points" | "accuracy_pct" | "correct_tips"
  >,
  b: Pick<
    LeaderboardSortRow,
    "display_name" | "total_points" | "accuracy_pct" | "correct_tips"
  >
) {
  if (b.total_points !== a.total_points) return b.total_points - a.total_points;
  if (b.accuracy_pct !== a.accuracy_pct) return b.accuracy_pct - a.accuracy_pct;
  if (b.correct_tips !== a.correct_tips) return b.correct_tips - a.correct_tips;
  return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
}

function numericSortValue<T extends LeaderboardSortRow>(row: T, key: NumericSortKey) {
  if (key === "rank") return row.rank;
  if (key === "total_points") return row.total_points;
  if (key === "correct_tips") return row.correct_tips;
  if (key === "accuracy_pct") return row.accuracy_pct;
  if (key === "round_score") return row.round_score;
  if (key === "movement") return row.movement;
  if (key === "behind_leader") return row.behind_leader;
  if (key === "current_streak") return row.current_streak;
  return row.avg_winning_odds;
}

export function buildLeaderboardScopeRankMeta<T extends LeaderboardSortRow>(rows: T[]) {
  const ranked = [...rows].sort(compareLeaderboardRankFields);

  const leaderPoints = ranked.length ? Number(ranked[0].total_points ?? 0) : 0;
  const byUserId = new Map<string, { rank: number; behind: number }>();

  ranked.forEach((row, index) => {
    byUserId.set(row.user_id, {
      rank: index + 1,
      behind: Math.max(0, leaderPoints - Number(row.total_points ?? 0)),
    });
  });

  return byUserId;
}

export function sortLeaderboardRows<T extends LeaderboardSortRow>(
  rows: T[],
  sortBy: LeaderboardSortKey = DEFAULT_LEADERBOARD_SORT_KEY,
  sortDirection: LeaderboardSortDirection = DEFAULT_LEADERBOARD_SORT_DIRECTION
) {
  const scopeRankMetaByUserId = buildLeaderboardScopeRankMeta(rows);
  const list = [...rows];

  function scopedNumericValue(row: T, key: NumericSortKey) {
    if (key === "rank") {
      return scopeRankMetaByUserId.get(row.user_id)?.rank ?? row.rank;
    }
    if (key === "behind_leader") {
      return scopeRankMetaByUserId.get(row.user_id)?.behind ?? row.behind_leader;
    }
    return numericSortValue(row, key);
  }

  list.sort((a, b) => {
    let primaryCmp = 0;

    if (sortBy === "display_name") {
      primaryCmp = a.display_name.localeCompare(b.display_name, "en", {
        sensitivity: "base",
      });
    } else {
      primaryCmp = scopedNumericValue(a, sortBy) - scopedNumericValue(b, sortBy);
    }

    const directionalPrimary = sortDirection === "asc" ? primaryCmp : -primaryCmp;
    if (directionalPrimary !== 0) return directionalPrimary;

    const rankTieBreak =
      (scopeRankMetaByUserId.get(a.user_id)?.rank ?? a.rank) -
      (scopeRankMetaByUserId.get(b.user_id)?.rank ?? b.rank);
    if (rankTieBreak !== 0) return rankTieBreak;

    return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
  });

  return list;
}
