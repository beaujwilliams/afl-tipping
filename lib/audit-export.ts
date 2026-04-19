import { createServiceClient } from "@/lib/supabase-server";

type SupabaseServiceClient = ReturnType<typeof createServiceClient>;

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

type MembershipRow = {
  user_id: string;
  is_test_account?: boolean | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

type MatchRow = {
  id: string;
  round_id: string;
  home_team: string;
  away_team: string;
};

type RawTipRow = {
  user_id: string;
  match_id: string;
  picked_team: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AuditLockedRound = {
  id: string;
  round_number: number;
  lock_time_utc: string;
};

export type AuditMemberOption = {
  user_id: string;
  display_name: string;
};

export type AuditExportRow = {
  round: number;
  member: string;
  match: string;
  final_pick: string;
  first_submitted_time: string | null;
  last_updated_time: string | null;
  lock_time: string;
  after_lock_change: boolean;
};

function isMissingColumnError(message: string, columnName: string) {
  const m = String(message ?? "").toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function toUtcMs(value: string | null | undefined) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function shortUserLabel(userId: string) {
  return `${String(userId).slice(0, 8)}…`;
}

export async function assertMemberAccess(params: {
  supabase: SupabaseServiceClient;
  competitionId: string;
  userId: string;
}) {
  const { data, error } = await params.supabase
    .from("memberships")
    .select("user_id")
    .eq("competition_id", params.competitionId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("You are not a member of this competition.");
  }
}

export async function getLockedRoundsForSeason(params: {
  supabase: SupabaseServiceClient;
  competitionId: string;
  season: number;
  nowMs?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();

  const { data, error } = await params.supabase
    .from("rounds")
    .select("id, round_number, lock_time_utc")
    .eq("competition_id", params.competitionId)
    .eq("season", params.season)
    .order("round_number", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as RoundRow[])
    .map((row) => {
      const lockMs = toUtcMs(row.lock_time_utc);
      if (lockMs === null || lockMs > nowMs) return null;
      return {
        id: String(row.id),
        round_number: Math.trunc(Number(row.round_number)),
        lock_time_utc: String(row.lock_time_utc),
      } as AuditLockedRound;
    })
    .filter((row): row is AuditLockedRound => !!row)
    .sort((a, b) => a.round_number - b.round_number);
}

export async function getEligibleMemberDirectory(params: {
  supabase: SupabaseServiceClient;
  competitionId: string;
}) {
  const { supabase, competitionId } = params;

  const withTest = await supabase
    .from("memberships")
    .select("user_id, is_test_account")
    .eq("competition_id", competitionId);

  let membershipRows: MembershipRow[] = [];
  if (withTest.error && isMissingColumnError(withTest.error.message, "is_test_account")) {
    const fallback = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", competitionId);
    if (fallback.error) {
      throw new Error(fallback.error.message);
    }
    membershipRows = ((fallback.data ?? []) as unknown as MembershipRow[]) ?? [];
  } else if (withTest.error) {
    throw new Error(withTest.error.message);
  } else {
    membershipRows = ((withTest.data ?? []) as unknown as MembershipRow[]) ?? [];
  }

  const eligibleUserIds = membershipRows
    .filter((row) => !Boolean(row.is_test_account))
    .map((row) => String(row.user_id))
    .filter(Boolean);

  const uniqueEligibleUserIds = Array.from(new Set(eligibleUserIds));
  if (uniqueEligibleUserIds.length === 0) {
    return {
      userIds: [] as string[],
      displayNameByUserId: {} as Record<string, string>,
      options: [] as AuditMemberOption[],
    };
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", uniqueEligibleUserIds);

  if (profileError) {
    throw new Error(profileError.message);
  }

  const displayNameByUserId: Record<string, string> = {};
  ((profiles ?? []) as ProfileRow[]).forEach((row) => {
    const id = String(row.id);
    const displayName = String(row.display_name ?? "").trim();
    displayNameByUserId[id] = displayName || shortUserLabel(id);
  });

  uniqueEligibleUserIds.forEach((userId) => {
    if (!displayNameByUserId[userId]) {
      displayNameByUserId[userId] = shortUserLabel(userId);
    }
  });

  const options = uniqueEligibleUserIds
    .map((userId) => ({
      user_id: userId,
      display_name: displayNameByUserId[userId],
    }))
    .sort((a, b) =>
      a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" })
    );

  return {
    userIds: uniqueEligibleUserIds,
    displayNameByUserId,
    options,
  };
}

async function loadTipRows(params: {
  supabase: SupabaseServiceClient;
  competitionId: string;
  matchIds: string[];
  userIds?: string[];
}) {
  const { supabase, competitionId, matchIds, userIds } = params;

  const applyFilters = (query: any) => {
    let next = query.eq("competition_id", competitionId).in("match_id", matchIds);
    if (Array.isArray(userIds) && userIds.length > 0) {
      next = next.in("user_id", userIds);
    }
    return next;
  };

  const full = await applyFilters(
    supabase.from("tips").select("user_id, match_id, picked_team, created_at, updated_at")
  );

  if (!full.error) {
    return {
      rows: ((full.data ?? []) as RawTipRow[]) ?? [],
      hasCreatedAt: true,
      hasUpdatedAt: true,
    };
  }

  const missingCreatedAt = isMissingColumnError(full.error.message, "created_at");
  const missingUpdatedAt = isMissingColumnError(full.error.message, "updated_at");
  if (!missingCreatedAt && !missingUpdatedAt) {
    throw new Error(full.error.message);
  }

  const fallbackColumns = [
    "user_id",
    "match_id",
    "picked_team",
    ...(missingCreatedAt ? [] : ["created_at"]),
    ...(missingUpdatedAt ? [] : ["updated_at"]),
  ];

  const fallback = await applyFilters(
    supabase.from("tips").select(fallbackColumns.join(", "))
  );
  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return {
    rows: ((fallback.data ?? []) as RawTipRow[]) ?? [],
    hasCreatedAt: !missingCreatedAt,
    hasUpdatedAt: !missingUpdatedAt,
  };
}

export async function buildAuditExportRows(params: {
  supabase: SupabaseServiceClient;
  competitionId: string;
  season: number;
  lockedRounds: AuditLockedRound[];
  displayNameByUserId: Record<string, string>;
  eligibleUserIds: string[];
  roundFilter?: number | null;
  userFilterIds?: string[];
}) {
  const { supabase, competitionId, lockedRounds, displayNameByUserId, eligibleUserIds } = params;

  const eligibleUserSet = new Set(eligibleUserIds.map((id) => String(id)));
  const selectedRoundFilter =
    typeof params.roundFilter === "number" && Number.isFinite(params.roundFilter)
      ? Math.trunc(params.roundFilter)
      : null;
  const selectedUserFilterSet =
    params.userFilterIds && params.userFilterIds.length > 0
      ? new Set(params.userFilterIds.map((id) => String(id)))
      : null;

  const targetRounds = lockedRounds.filter((round) =>
    selectedRoundFilter === null ? true : round.round_number === selectedRoundFilter
  );

  if (targetRounds.length === 0) {
    return [] as AuditExportRow[];
  }

  const roundById = new Map(targetRounds.map((round) => [round.id, round] as const));
  const targetRoundIds = targetRounds.map((round) => round.id);

  const { data: matches, error: matchError } = await supabase
    .from("matches")
    .select("id, round_id, home_team, away_team")
    .in("round_id", targetRoundIds);

  if (matchError) {
    throw new Error(matchError.message);
  }

  const matchRows = ((matches ?? []) as MatchRow[]) ?? [];
  if (matchRows.length === 0) {
    return [] as AuditExportRow[];
  }

  const matchById = new Map<string, MatchRow>();
  const matchIds = matchRows.map((row) => {
    const id = String(row.id);
    matchById.set(id, row);
    return id;
  });

  const tipRowsResult = await loadTipRows({
    supabase,
    competitionId,
    matchIds,
    userIds: selectedUserFilterSet ? Array.from(selectedUserFilterSet) : undefined,
  });

  const rows: AuditExportRow[] = [];
  for (const tip of tipRowsResult.rows) {
    const userId = String(tip.user_id);
    if (!eligibleUserSet.has(userId)) continue;
    if (selectedUserFilterSet && !selectedUserFilterSet.has(userId)) continue;

    const matchId = String(tip.match_id);
    const match = matchById.get(matchId);
    if (!match) continue;

    const round = roundById.get(String(match.round_id));
    if (!round) continue;

    const finalPick = String(tip.picked_team ?? "").trim();
    if (!finalPick) continue;

    const firstSubmittedTime = tipRowsResult.hasCreatedAt
      ? tip.created_at ?? tip.updated_at ?? null
      : tip.updated_at ?? null;

    const lastUpdatedTime = tipRowsResult.hasUpdatedAt
      ? tip.updated_at ?? tip.created_at ?? null
      : tip.created_at ?? null;

    const lockMs = toUtcMs(round.lock_time_utc);
    const updatedMs = toUtcMs(lastUpdatedTime);
    const afterLockChange =
      lockMs !== null && updatedMs !== null ? updatedMs > lockMs : false;

    rows.push({
      round: round.round_number,
      member: displayNameByUserId[userId] ?? shortUserLabel(userId),
      match: `${String(match.home_team)} vs ${String(match.away_team)}`,
      final_pick: finalPick,
      first_submitted_time: firstSubmittedTime,
      last_updated_time: lastUpdatedTime,
      lock_time: round.lock_time_utc,
      after_lock_change: afterLockChange,
    });
  }

  rows.sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    const memberCmp = a.member.localeCompare(b.member, "en", {
      sensitivity: "base",
    });
    if (memberCmp !== 0) return memberCmp;
    return a.match.localeCompare(b.match, "en", { sensitivity: "base" });
  });

  return rows;
}
