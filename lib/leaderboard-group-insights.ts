export type GroupSummaryInputRow = {
  user_id: string;
  display_name: string;
  rank: number;
  behind: number;
  total_points: number;
  movement: number;
  round_score: number;
};

export type GroupSummary = {
  leader: {
    user_id: string;
    display_name: string;
    total_points: number;
  } | null;
  me: {
    user_id: string;
    display_name: string;
    rank: number;
    behind: number;
  } | null;
  biggestMover: {
    user_id: string;
    display_name: string;
    movement: number;
  } | null;
  roundLeader: {
    user_id: string;
    display_name: string;
    round_score: number;
  } | null;
};

export type CreatorInviteStatusKey =
  | "pending"
  | "declined"
  | "not_invited"
  | "member"
  | "accepted";

export function computeLeaderboardGroupSummary(params: {
  rows: GroupSummaryInputRow[];
  currentUserId: string | null;
}): GroupSummary {
  const rows = [...params.rows].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (b.total_points !== a.total_points) return b.total_points - a.total_points;
    return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
  });

  const leader = rows[0]
    ? {
        user_id: rows[0].user_id,
        display_name: rows[0].display_name,
        total_points: rows[0].total_points,
      }
    : null;

  const meRow = params.currentUserId
    ? rows.find((row) => row.user_id === params.currentUserId) ?? null
    : null;

  const me = meRow
    ? {
        user_id: meRow.user_id,
        display_name: meRow.display_name,
        rank: meRow.rank,
        behind: meRow.behind,
      }
    : null;

  const biggestMoverRow =
    [...rows]
      .filter((row) => row.movement > 0)
      .sort((a, b) => {
        if (b.movement !== a.movement) return b.movement - a.movement;
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
      })[0] ?? null;

  const biggestMover = biggestMoverRow
    ? {
        user_id: biggestMoverRow.user_id,
        display_name: biggestMoverRow.display_name,
        movement: biggestMoverRow.movement,
      }
    : null;

  const roundLeaderRow =
    [...rows].sort((a, b) => {
      if (b.round_score !== a.round_score) return b.round_score - a.round_score;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
    })[0] ?? null;

  const roundLeader = roundLeaderRow
    ? {
        user_id: roundLeaderRow.user_id,
        display_name: roundLeaderRow.display_name,
        round_score: roundLeaderRow.round_score,
      }
    : null;

  return {
    leader,
    me,
    biggestMover,
    roundLeader,
  };
}

export function summarizeCreatorInviteStatuses(
  rows: Array<{ statusKey: CreatorInviteStatusKey }>
) {
  const counts: Record<CreatorInviteStatusKey, number> = {
    pending: 0,
    declined: 0,
    not_invited: 0,
    member: 0,
    accepted: 0,
  };

  rows.forEach((row) => {
    counts[row.statusKey] += 1;
  });

  return counts;
}
