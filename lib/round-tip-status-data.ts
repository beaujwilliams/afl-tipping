import { createServiceClient } from "@/lib/supabase-server";
import { resolveReigningChampion } from "@/lib/reigning-champion";
import { buildRoundTipStatusPlayerLists } from "@/lib/round-tip-status-rules";

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
  updated_at: string | null;
};

type UserTipRow = {
  match_id: string;
};

type ReminderEmailLogRow = {
  round_id: string;
  user_id: string;
  sent_at_utc: string | null;
};

export type RoundPlayerStatusRow = {
  user_id: string;
  display_name: string | null;
  payment_status: string | null;
  tips_entered: number;
  latest_submitted_at_utc?: string | null;
  last_reminded_at_utc?: string | null;
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
    reigning_champion_user_id?: string | null;
    champion_highlight_user_ids?: string[];
    champion_seasons_by_user_id?: Record<string, number[]>;
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
  champion_seasons_by_user_id?: Record<string, number[]>;
  admin: boolean;
  rounds: RoundTipStatusRound[];
};

const ROUND_TIP_STATUS_CACHE_TABLE = "round_tip_status_cache";
const SUPABASE_PAGE_SIZE = 1000;

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

async function readCompetitionTipsForMatches(params: {
  supabase: ReturnType<typeof createServiceClient>;
  competitionId: string;
  matchIds: string[];
}) {
  if (!params.matchIds.length) return [] as TipRow[];

  const out: TipRow[] = [];
  let from = 0;
  let includeUpdatedAt = true;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;

    const { data, error } = await params.supabase
      .from("tips")
      .select(includeUpdatedAt ? "user_id, match_id, updated_at" : "user_id, match_id")
      .eq("competition_id", params.competitionId)
      .in("match_id", params.matchIds)
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      if (includeUpdatedAt && isMissingColumnError(error.message, "updated_at")) {
        includeUpdatedAt = false;
        continue;
      }
      throw new Error(`Failed to read tips: ${error.message}`);
    }

    const batch = (data ?? []) as unknown as Array<{
      user_id: string;
      match_id: string;
      updated_at?: string | null;
    }>;
    out.push(
      ...batch.map((row) => ({
        user_id: String(row.user_id),
        match_id: String(row.match_id),
        updated_at: row.updated_at ?? null,
      }))
    );

    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return out;
}

async function readReminderLogsForRounds(params: {
  supabase: ReturnType<typeof createServiceClient>;
  competitionId: string;
  season: number;
  roundIds: string[];
}) {
  if (!params.roundIds.length) return [] as ReminderEmailLogRow[];

  const out: ReminderEmailLogRow[] = [];
  let from = 0;
  let includeSeasonFilter = true;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    let query = params.supabase
      .from("prelock_reminder_emails")
      .select("round_id, user_id, sent_at_utc")
      .eq("competition_id", params.competitionId)
      .in("round_id", params.roundIds)
      .eq("status", "sent")
      .order("id", { ascending: true })
      .range(from, to);

    if (includeSeasonFilter) {
      query = query.eq("season", params.season);
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingRelationError(error.message, "prelock_reminder_emails")) {
        return [];
      }
      if (includeSeasonFilter && isMissingColumnError(error.message, "season")) {
        includeSeasonFilter = false;
        continue;
      }
      throw new Error(`Failed to read reminder logs: ${error.message}`);
    }

    const batch = (data ?? []) as Array<{
      round_id: string;
      user_id: string;
      sent_at_utc?: string | null;
    }>;
    out.push(
      ...batch.map((row) => ({
        round_id: String(row.round_id),
        user_id: String(row.user_id),
        sent_at_utc: row.sent_at_utc ?? null,
      }))
    );

    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return out;
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
  const tipCountByRoundUser = new Map<string, Map<string, number>>();
  const latestSubmittedAtByRoundUser = new Map<string, Map<string, string>>();
  const lastReminderAtByRoundUser = new Map<string, Map<string, string>>();

  const setLatestRoundTimestamp = (
    byRoundMap: Map<string, Map<string, string>>,
    roundId: string,
    userId: string,
    iso: string | null | undefined
  ) => {
    if (!iso) return;
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return;

    if (!byRoundMap.has(roundId)) {
      byRoundMap.set(roundId, new Map<string, string>());
    }
    const byUser = byRoundMap.get(roundId)!;
    const existing = byUser.get(userId);
    if (!existing || parsed > Date.parse(existing)) {
      byUser.set(userId, iso);
    }
  };

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

  if (matchIds.length) {
    const tips = await readCompetitionTipsForMatches({
      supabase,
      competitionId: params.competitionId,
      matchIds,
    });

    tips.forEach((t) => {
      const uid = String(t.user_id);
      const rid = matchToRound.get(String(t.match_id));
      if (!rid) return;

      if (!tipCountByRoundUser.has(rid)) {
        tipCountByRoundUser.set(rid, new Map<string, number>());
      }
      const byUser = tipCountByRoundUser.get(rid)!;
      byUser.set(uid, (byUser.get(uid) ?? 0) + 1);
      setLatestRoundTimestamp(latestSubmittedAtByRoundUser, rid, uid, t.updated_at);
    });
  }

  if (roundIds.length) {
    const reminderLogs = await readReminderLogsForRounds({
      supabase,
      competitionId: params.competitionId,
      season: params.season,
      roundIds,
    });

    reminderLogs.forEach((row) => {
      setLatestRoundTimestamp(
        lastReminderAtByRoundUser,
        String(row.round_id),
        String(row.user_id),
        row.sent_at_utc
      );
    });
  }

  const roundsPayload: CachedRoundStatusRow[] = roundList.map((r) => {
    const totalMatches = totalMatchesByRound.get(r.id) ?? 0;
    const completedMatches = completedMatchesByRound.get(r.id) ?? 0;
    const roundComplete = totalMatches > 0 && completedMatches >= totalMatches;
    const tipsByUser = tipCountByRoundUser.get(r.id) ?? new Map<string, number>();
    const { missingPlayers, tippedPlayers, tippedCount, missingCount } =
      buildRoundTipStatusPlayerLists({
        memberIds,
        totalMatches,
        profileNameByUserId: profileMap,
        paymentStatusByUserId,
        tipCountByUserId: tipsByUser,
        latestSubmittedAtByUserId: latestSubmittedAtByRoundUser.get(r.id),
        lastReminderAtByUserId: lastReminderAtByRoundUser.get(r.id),
      });

    return {
      round_id: r.id,
      round_number: r.round_number,
      lock_time_utc: r.lock_time_utc,
      total_matches: totalMatches,
      completed_matches: completedMatches,
      round_complete: roundComplete,
      total_players: memberIds.length,
      tipped_players: tippedCount,
      missing_count: missingCount,
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
    if (!cached.payload.champion_seasons_by_user_id) {
      const reigningChampion = await resolveReigningChampion({
        competitionId: params.competitionId,
        season: params.season,
        supabase,
      });

      return {
        ...cached.payload,
        reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
        champion_highlight_user_ids: reigningChampion.champion_highlight_user_ids,
        champion_seasons_by_user_id: reigningChampion.champion_seasons_by_user_id,
      };
    }
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
    champion_seasons_by_user_id: reigningChampion.champion_seasons_by_user_id,
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
