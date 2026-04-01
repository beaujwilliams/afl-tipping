import { createServiceClient } from "@/lib/supabase-server";
import { resolveReigningChampion } from "@/lib/reigning-champion";

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
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

type MatchRow = {
  id: string;
  round_id: string;
  winner_team: string | null;
};

type TipRow = {
  user_id: string;
  match_id: string;
};

type UserTipRow = {
  match_id: string;
};

export type RoundPlayerStatusRow = {
  user_id: string;
  display_name: string | null;
  payment_status: string | null;
  tips_entered: number;
};

type CachedRoundStatusRow = {
  round_id: string;
  round_number: number;
  lock_time_utc: string | null;
  total_matches: number;
  completed_matches: number;
  round_complete: boolean;
  total_players: number;
  tipped_players: number;
  missing_count: number;
  match_ids: string[];
  missing_players: RoundPlayerStatusRow[];
  tipped_players_list: RoundPlayerStatusRow[];
};

type RoundTipStatusCacheRow = {
  payload: {
    rounds: CachedRoundStatusRow[];
  };
  computed_at: string | null;
};

export type RoundTipStatusRound = {
  round_id: string;
  round_number: number;
  lock_time_utc: string | null;
  total_matches: number;
  completed_matches: number;
  round_complete: boolean;
  my_tips: number;
  total_players: number;
  tipped_players: number;
  missing_count: number;
  missing_players?: RoundPlayerStatusRow[];
  tipped_players_list?: RoundPlayerStatusRow[];
};

export type RoundTipStatusResponse = {
  ok: true;
  season: number;
  competition_id: string;
  reigning_champion_user_id?: string | null;
  champion_highlight_user_ids?: string[];
  admin: boolean;
  rounds: RoundTipStatusRound[];
};

const ROUND_TIP_STATUS_CACHE_TABLE = "round_tip_status_cache";

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

function sortPlayersByName(a: RoundPlayerStatusRow, b: RoundPlayerStatusRow) {
  const aName = String(a.display_name ?? "").trim();
  const bName = String(b.display_name ?? "").trim();
  if (aName && bName) {
    const cmp = aName.localeCompare(bName, "en", { sensitivity: "base" });
    if (cmp !== 0) return cmp;
  } else if (aName) {
    return -1;
  } else if (bName) {
    return 1;
  }
  return String(a.user_id).localeCompare(String(b.user_id));
}

async function computeRoundTipStatusAggregate(params: {
  competitionId: string;
  season: number;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  const { data: rounds, error: rErr } = await supabase
    .from("rounds")
    .select("id, round_number, lock_time_utc")
    .eq("competition_id", params.competitionId)
    .eq("season", params.season)
    .order("round_number", { ascending: true });

  if (rErr) {
    throw new Error(`Failed to read rounds: ${rErr.message}`);
  }

  const roundList = (rounds ?? []) as RoundRow[];
  const roundIds = roundList.map((r) => r.id);

  let members: MembershipRow[] = [];
  const withPaymentAndTest = await supabase
    .from("memberships")
    .select("user_id, payment_status, is_test_account")
    .eq("competition_id", params.competitionId);

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
      .eq("competition_id", params.competitionId);

    if (fallback.error) {
      throw new Error(`Failed to read memberships: ${fallback.error.message}`);
    }

    members = (fallback.data ?? []) as unknown as MembershipRow[];
  } else if (withPaymentAndTest.error) {
    throw new Error(`Failed to read memberships: ${withPaymentAndTest.error.message}`);
  } else {
    members = (withPaymentAndTest.data ?? []) as unknown as MembershipRow[];
  }

  const eligibleMembers = members.filter((m) => !Boolean(m.is_test_account));
  const memberIds = eligibleMembers.map((m) => String(m.user_id));
  const paymentStatusByUserId = new Map<string, string | null>();
  eligibleMembers.forEach((m) => {
    paymentStatusByUserId.set(
      String(m.user_id),
      normalizePaymentStatus(m.payment_status ?? null)
    );
  });

  const profileMap = new Map<string, string | null>();
  if (memberIds.length) {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", memberIds);

    if (profErr) {
      throw new Error(`Failed to read profiles: ${profErr.message}`);
    }

    (profs as ProfileRow[] | null)?.forEach((p) => {
      profileMap.set(String(p.id), p.display_name ?? null);
    });
  }

  const matchIds: string[] = [];
  const matchIdsByRound = new Map<string, string[]>();
  const matchToRound = new Map<string, string>();
  const totalMatchesByRound = new Map<string, number>();
  const completedMatchesByRound = new Map<string, number>();

  if (roundIds.length) {
    const { data: matches, error: mErr } = await supabase
      .from("matches")
      .select("id, round_id, winner_team")
      .in("round_id", roundIds);

    if (mErr) {
      throw new Error(`Failed to read matches: ${mErr.message}`);
    }

    (matches as MatchRow[] | null)?.forEach((m) => {
      const mid = String(m.id);
      const rid = String(m.round_id);
      matchIds.push(mid);
      matchToRound.set(mid, rid);
      matchIdsByRound.set(rid, [...(matchIdsByRound.get(rid) ?? []), mid]);
      totalMatchesByRound.set(rid, (totalMatchesByRound.get(rid) ?? 0) + 1);
      if (String(m.winner_team ?? "").trim()) {
        completedMatchesByRound.set(rid, (completedMatchesByRound.get(rid) ?? 0) + 1);
      }
    });
  }

  const tipCountByRoundUser = new Map<string, Map<string, number>>();

  if (matchIds.length) {
    const { data: tips, error: tErr } = await supabase
      .from("tips")
      .select("user_id, match_id")
      .eq("competition_id", params.competitionId)
      .in("match_id", matchIds);

    if (tErr) {
      throw new Error(`Failed to read tips: ${tErr.message}`);
    }

    (tips as TipRow[] | null)?.forEach((t) => {
      const uid = String(t.user_id);
      const rid = matchToRound.get(String(t.match_id));
      if (!rid) return;

      if (!tipCountByRoundUser.has(rid)) {
        tipCountByRoundUser.set(rid, new Map<string, number>());
      }
      const byUser = tipCountByRoundUser.get(rid)!;
      byUser.set(uid, (byUser.get(uid) ?? 0) + 1);
    });
  }

  const roundsPayload: CachedRoundStatusRow[] = roundList.map((r) => {
    const totalMatches = totalMatchesByRound.get(r.id) ?? 0;
    const completedMatches = completedMatchesByRound.get(r.id) ?? 0;
    const roundComplete = totalMatches > 0 && completedMatches >= totalMatches;
    const tipsByUser = tipCountByRoundUser.get(r.id) ?? new Map<string, number>();
    const hasCompletedTips = (uid: string) =>
      totalMatches > 0 && (tipsByUser.get(uid) ?? 0) >= totalMatches;

    const tippedCount = memberIds.reduce((acc, uid) => {
      return acc + (hasCompletedTips(uid) ? 1 : 0);
    }, 0);

    const missingPlayers: RoundPlayerStatusRow[] = [];
    const tippedPlayers: RoundPlayerStatusRow[] = [];

    for (const uid of memberIds) {
      const tipsEntered = Math.min(tipsByUser.get(uid) ?? 0, totalMatches);
      const row: RoundPlayerStatusRow = {
        user_id: uid,
        display_name: profileMap.get(uid) ?? null,
        payment_status: paymentStatusByUserId.get(uid) ?? null,
        tips_entered: tipsEntered,
      };

      if (hasCompletedTips(uid)) tippedPlayers.push(row);
      else missingPlayers.push(row);
    }

    missingPlayers.sort(sortPlayersByName);
    tippedPlayers.sort(sortPlayersByName);

    return {
      round_id: r.id,
      round_number: r.round_number,
      lock_time_utc: r.lock_time_utc,
      total_matches: totalMatches,
      completed_matches: completedMatches,
      round_complete: roundComplete,
      total_players: memberIds.length,
      tipped_players: tippedCount,
      missing_count: Math.max(0, memberIds.length - tippedCount),
      match_ids: matchIdsByRound.get(r.id) ?? [],
      missing_players: missingPlayers,
      tipped_players_list: tippedPlayers,
    };
  });

  return {
    rounds: roundsPayload,
  };
}

async function readRoundTipStatusCache(params: {
  competitionId: string;
  season: number;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  const { data, error } = await supabase
    .from(ROUND_TIP_STATUS_CACHE_TABLE)
    .select("payload, computed_at")
    .eq("competition_id", params.competitionId)
    .eq("season", params.season)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error.message, ROUND_TIP_STATUS_CACHE_TABLE)) {
      return null;
    }
    throw new Error(`Failed to read round tip status cache: ${error.message}`);
  }

  if (!data) return null;
  return data as RoundTipStatusCacheRow;
}

async function writeRoundTipStatusCache(params: {
  competitionId: string;
  season: number;
  payload: { rounds: CachedRoundStatusRow[] };
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  const { error } = await supabase.from(ROUND_TIP_STATUS_CACHE_TABLE).upsert(
    {
      competition_id: params.competitionId,
      season: params.season,
      payload: params.payload,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "competition_id,season" }
  );

  if (error && !isMissingRelationError(error.message, ROUND_TIP_STATUS_CACHE_TABLE)) {
    throw new Error(`Failed to write round tip status cache: ${error.message}`);
  }
}

async function getRoundTipStatusAggregate(params: {
  competitionId: string;
  season: number;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();
  const cached = await readRoundTipStatusCache({
    competitionId: params.competitionId,
    season: params.season,
    supabase,
  });

  if (cached?.payload?.rounds) {
    return cached.payload;
  }

  const payload = await computeRoundTipStatusAggregate({
    competitionId: params.competitionId,
    season: params.season,
    supabase,
  });
  await writeRoundTipStatusCache({
    competitionId: params.competitionId,
    season: params.season,
    payload,
    supabase,
  });
  return payload;
}

export async function getRoundTipStatusResponse(params: {
  competitionId: string;
  season: number;
  userId: string;
  admin: boolean;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();
  const aggregate = await getRoundTipStatusAggregate({
    competitionId: params.competitionId,
    season: params.season,
    supabase,
  });

  const reigningChampion = await resolveReigningChampion({
    competitionId: params.competitionId,
    season: params.season,
    supabase,
  });

  const roundIdByMatchId = new Map<string, string>();
  const allMatchIds: string[] = [];
  aggregate.rounds.forEach((round) => {
    round.match_ids.forEach((matchId) => {
      roundIdByMatchId.set(matchId, round.round_id);
      allMatchIds.push(matchId);
    });
  });

  const userTipCountByRound = new Map<string, number>();
  if (allMatchIds.length) {
    const { data: tips, error: tipErr } = await supabase
      .from("tips")
      .select("match_id")
      .eq("competition_id", params.competitionId)
      .eq("user_id", params.userId)
      .in("match_id", allMatchIds);

    if (tipErr) {
      throw new Error(`Failed to read user tips: ${tipErr.message}`);
    }

    (tips as UserTipRow[] | null)?.forEach((tip) => {
      const roundId = roundIdByMatchId.get(String(tip.match_id));
      if (!roundId) return;
      userTipCountByRound.set(roundId, (userTipCountByRound.get(roundId) ?? 0) + 1);
    });
  }

  const rounds: RoundTipStatusRound[] = aggregate.rounds.map((round) => ({
    round_id: round.round_id,
    round_number: round.round_number,
    lock_time_utc: round.lock_time_utc,
    total_matches: round.total_matches,
    completed_matches: round.completed_matches,
    round_complete: round.round_complete,
    my_tips: Math.min(userTipCountByRound.get(round.round_id) ?? 0, round.total_matches),
    total_players: round.total_players,
    tipped_players: round.tipped_players,
    missing_count: round.missing_count,
    missing_players: params.admin ? round.missing_players : undefined,
    tipped_players_list: params.admin ? round.tipped_players_list : undefined,
  }));

  return {
    ok: true as const,
    season: params.season,
    competition_id: params.competitionId,
    reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
    champion_highlight_user_ids: reigningChampion.champion_highlight_user_ids,
    admin: params.admin,
    rounds,
  };
}

export async function invalidateRoundTipStatusCache(params: {
  competitionId: string;
  season?: number | null;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  let query = supabase
    .from(ROUND_TIP_STATUS_CACHE_TABLE)
    .delete()
    .eq("competition_id", params.competitionId);

  if (params.season !== undefined && params.season !== null) {
    query = query.eq("season", params.season);
  }

  const { error } = await query;
  if (error && !isMissingRelationError(error.message, ROUND_TIP_STATUS_CACHE_TABLE)) {
    throw new Error(`Failed to invalidate round tip status cache: ${error.message}`);
  }
}
