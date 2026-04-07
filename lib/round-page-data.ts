import { createServiceClient } from "@/lib/supabase-server";
import {
  buildRoundPageOddsMap,
  computeRoundPagePaymentLock,
  isMissingColumnError,
  normalizeRoundPagePaymentStatus,
  normalizeRoundPageRole,
  pickRoundCandidate,
} from "@/lib/round-page-rules";

export type RoundPageRoundRow = {
  id: string;
  competition_id: string;
  season: number;
  round_number: number;
  lock_time_utc: string;
  odds_snapshot_for_time_utc: string | null;
};

export type RoundPageMatchRow = {
  id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  venue: string | null;
  status: string;
  winner_team: string | null;
};

export type RoundPageTipRow = {
  match_id: string;
  picked_team: string;
};

export type RoundPageOddsRow = {
  match_id: string;
  home_team: string;
  away_team: string;
  home_odds: number;
  away_odds: number;
  captured_at_utc: string;
  snapshot_for_time_utc?: string;
};

export type RoundPagePaymentStatus = "paid" | "pending" | "waived";
export type RoundPageMemberRole = "owner" | "admin" | "member";

export type RoundPageUserMembershipRow = {
  competition_id: string;
  role?: string | null;
  payment_status?: string | null;
};

export type RoundPageInitialData = {
  user_id: string;
  competition_id: string;
  round_row: RoundPageRoundRow | null;
  matches: RoundPageMatchRow[];
  tips_by_match_id: Record<string, string>;
  payment_status: RoundPagePaymentStatus;
  payment_locked: boolean;
  enforce_unpaid_tip_lock: boolean;
  odds_by_match_id: Record<string, RoundPageOddsRow>;
  odds_info: string;
};

function formatMelbourne(isoUtc: string) {
  const d = new Date(isoUtc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function oddsLockLabel(snapshot: string | null) {
  return snapshot
    ? `Scoring odds time: ${formatMelbourne(snapshot)} (Melbourne)`
    : "Scoring odds time not set yet (showing latest available odds)";
}

export async function getRoundPageInitialData(params: {
  season: number;
  round: number;
  userId: string;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  const membershipsRes = await supabase
    .from("memberships")
    .select("competition_id, role, payment_status")
    .eq("user_id", params.userId);

  if (membershipsRes.error) {
    return {
      initialData: null as RoundPageInitialData | null,
      initialMessage: `Could not load memberships: ${membershipsRes.error.message}`,
    };
  }

  const memberships = (membershipsRes.data ?? []) as RoundPageUserMembershipRow[];
  const competitionIds = Array.from(
    new Set(memberships.map((membership) => String(membership.competition_id)))
  );
  const membershipByCompetition: Record<string, RoundPageUserMembershipRow> = {};
  memberships.forEach((membership) => {
    membershipByCompetition[String(membership.competition_id)] = membership;
  });

  let roundCandidatesQuery = supabase
    .from("rounds")
    .select("id, competition_id, season, round_number, lock_time_utc, odds_snapshot_for_time_utc")
    .eq("season", params.season)
    .eq("round_number", params.round);

  if (competitionIds.length) {
    roundCandidatesQuery = roundCandidatesQuery.in("competition_id", competitionIds);
  }

  let roundCandidatesRes = await roundCandidatesQuery;

  if ((!roundCandidatesRes.data || roundCandidatesRes.data.length === 0) && competitionIds.length) {
    roundCandidatesRes = await supabase
      .from("rounds")
      .select("id, competition_id, season, round_number, lock_time_utc, odds_snapshot_for_time_utc")
      .eq("season", params.season)
      .eq("round_number", params.round);
  }

  if (roundCandidatesRes.error) {
    return {
      initialData: null as RoundPageInitialData | null,
      initialMessage: `Could not load round: ${roundCandidatesRes.error.message}`,
    };
  }

  const roundCandidates = (roundCandidatesRes.data ?? []) as RoundPageRoundRow[];
  if (!roundCandidates.length) {
    return {
      initialData: null as RoundPageInitialData | null,
      initialMessage: "Round not found.",
    };
  }

  const pickedRound = pickRoundCandidate(roundCandidates, membershipByCompetition);
  if (!pickedRound) {
    return {
      initialData: null as RoundPageInitialData | null,
      initialMessage: "Round not found.",
    };
  }

  const competitionId = String(pickedRound.competition_id);
  const membership = membershipByCompetition[competitionId] ?? null;
  const memberRole = normalizeRoundPageRole(membership?.role ?? null);
  const memberPaymentStatus = normalizeRoundPagePaymentStatus(membership?.payment_status ?? null);

  const [compSettings, matchesRes] = await Promise.all([
    supabase
      .from("competitions")
      .select("enforce_unpaid_tip_lock")
      .eq("id", competitionId)
      .single(),
    supabase
      .from("matches")
      .select("id, commence_time_utc, home_team, away_team, venue, status, winner_team")
      .eq("round_id", pickedRound.id)
      .order("commence_time_utc", { ascending: true }),
  ]);

  if (matchesRes.error) {
    return {
      initialData: null as RoundPageInitialData | null,
      initialMessage: `Error loading matches: ${matchesRes.error.message}`,
    };
  }

  let enforceLock = false;
  if (!compSettings.error && compSettings.data) {
    enforceLock = !!(
      compSettings.data as { enforce_unpaid_tip_lock?: boolean | null }
    ).enforce_unpaid_tip_lock;
  } else if (
    compSettings.error &&
    isMissingColumnError(compSettings.error.message, "enforce_unpaid_tip_lock")
  ) {
    enforceLock = false;
  }

  const matches = (matchesRes.data ?? []) as RoundPageMatchRow[];
  const matchIds = matches.map((match) => match.id);
  const snapshot = pickedRound.odds_snapshot_for_time_utc ?? null;

  const [tipsRes, oddsRes] = await Promise.all([
    matchIds.length
      ? supabase
          .from("tips")
          .select("match_id, picked_team")
          .eq("competition_id", competitionId)
          .eq("user_id", params.userId)
          .in("match_id", matchIds)
      : Promise.resolve({ data: [], error: null }),
    matchIds.length
      ? (() => {
          let query = supabase
            .from("match_odds")
            .select(
              "match_id, home_team, away_team, home_odds, away_odds, captured_at_utc, snapshot_for_time_utc"
            )
            .eq("competition_id", competitionId)
            .in("match_id", matchIds);

          if (snapshot) {
            query = query.eq("snapshot_for_time_utc", snapshot);
          } else {
            query = query.order("snapshot_for_time_utc", { ascending: false });
          }

          return query.order("captured_at_utc", { ascending: false });
        })()
      : Promise.resolve({ data: [], error: null }),
  ]);

  const tipsByMatchId: Record<string, string> = {};
  if (!tipsRes.error) {
    ((tipsRes.data ?? []) as RoundPageTipRow[]).forEach((tip) => {
      tipsByMatchId[tip.match_id] = tip.picked_team;
    });
  }

  let oddsByMatchId: Record<string, RoundPageOddsRow> = {};
  let oddsInfo = "";
  if (oddsRes.error) {
    oddsInfo = `Odds not loaded: ${oddsRes.error.message}`;
  } else {
    oddsByMatchId = buildRoundPageOddsMap((oddsRes.data ?? []) as RoundPageOddsRow[]);
    const have = Object.keys(oddsByMatchId).length;
    oddsInfo = have
      ? `Odds loaded for ${have}/${matchIds.length} matches. • ${oddsLockLabel(snapshot)}`
      : `No odds loaded yet for this round. • ${oddsLockLabel(snapshot)}`;
  }

  return {
    initialData: {
      user_id: params.userId,
      competition_id: competitionId,
      round_row: pickedRound,
      matches,
      tips_by_match_id: tipsByMatchId,
      payment_status: memberPaymentStatus,
      payment_locked: computeRoundPagePaymentLock({
        memberRole,
        memberPaymentStatus,
        enforceLock,
      }),
      enforce_unpaid_tip_lock: enforceLock,
      odds_by_match_id: oddsByMatchId,
      odds_info: oddsInfo,
    },
    initialMessage: "",
  };
}
