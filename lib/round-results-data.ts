import { createServiceClient } from "@/lib/supabase-server";
import { resolveCompetitionIdForSeasonRound } from "@/lib/competition-resolver";
import { isPostLockDataVisible } from "@/lib/post-lock-visibility";
import { resolveReigningChampion } from "@/lib/reigning-champion";
import {
  buildRoundResultsSnapshot,
  pickFirstOddsByMatch,
} from "@/lib/round-results-rules";

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
  const nowMs = params.nowMs ?? Date.now();

  if (!isPostLockDataVisible(lockTimeUtc, nowMs)) {
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

  const oddsByMatchId = pickFirstOddsByMatch((oddsRows ?? []) as OddsRow[]);
  const eligiblePlayers = Array.from(eligibleUserIds).map((userId) => ({
    user_id: userId,
    display_name: nameByUserId[userId] ?? "Anonymous tipster",
    payment_status: paymentStatusByUserId[userId] ?? null,
  }));
  const snapshot = buildRoundResultsSnapshot({
    matches: matchList,
    tips: tipRows,
    eligiblePlayers,
    oddsByMatchId,
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
    matches: snapshot.matches as MatchResultRow[],
    players: snapshot.players as PlayerRoundScore[],
  };
}
