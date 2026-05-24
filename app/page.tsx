import { Suspense } from "react";
import HomePageClient from "@/components/HomePageClient";
import HomePageFallback from "@/components/HomePageFallback";
import { createClient, createServiceClient } from "@/lib/supabase-server";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";
import { getRoundTipStatusResponse } from "@/lib/round-tip-status-data";
import { getLeaderboardSnapshot } from "@/lib/leaderboard-snapshot";
import LoginPage from "@/app/login/page";

const CURRENT_SEASON = 2026;
const LIVE_SIGNAL_GRACE_MS = 6 * 60 * 60 * 1000;

type HomeTodayPickRow = {
  match_id: string;
  round_number?: number;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  picked_team: string | null;
  winner_team: string | null;
  status: string | null;
};

type HomeFirstMatchRow = {
  round_id: string;
  round_number?: number;
  match_id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
};

type HomeRoundStatusRow = Awaited<ReturnType<typeof getRoundTipStatusResponse>>["rounds"][number];
type HomeAuthedUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function fallbackWelcomeName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const metadataNameCandidates = [metadata.display_name, metadata.full_name, metadata.name]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  const emailName = String(user.email ?? "")
    .split("@")[0]
    ?.trim();
  return metadataNameCandidates[0] || emailName || "";
}

function melbourneDayKey(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function roundLockMs(value: string | null) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isRoundComplete(row: HomeRoundStatusRow | null | undefined) {
  if (!row) return false;
  return (
    Boolean(row.round_complete) ||
    (Number(row.total_matches ?? 0) > 0 &&
      Number(row.completed_matches ?? 0) >= Number(row.total_matches ?? 0))
  );
}

function resolvePrimaryRoundForHome(rounds: HomeRoundStatusRow[], nowMs: number) {
  const sorted = [...rounds].sort((a, b) => Number(a.round_number) - Number(b.round_number));
  if (!sorted.length) return null;

  const liveRound =
    [...sorted].reverse().find((round) => {
      const lockMs = roundLockMs(round.lock_time_utc);
      if (lockMs === null || nowMs < lockMs) return false;
      if (Number(round.total_matches ?? 0) <= 0) return false;
      if (isRoundComplete(round)) return false;

      const completedMatches = Number(round.completed_matches ?? 0);
      const recentlyLocked = nowMs - lockMs <= LIVE_SIGNAL_GRACE_MS;
      return completedMatches > 0 || recentlyLocked;
    }) ?? null;

  const nextOpenRound = sorted.find((round) => {
    const lockMs = roundLockMs(round.lock_time_utc);
    return lockMs !== null && nowMs < lockMs;
  });

  if (liveRound) return liveRound;
  if (nextOpenRound) return nextOpenRound;
  return sorted[sorted.length - 1] ?? null;
}

async function HomePageData({
  user,
  initialWelcomeName,
}: {
  user: HomeAuthedUser;
  initialWelcomeName: string;
}) {
  const supabase = createServiceClient();
  let welcomeName = initialWelcomeName;
  let initialMessage: string | null = null;
  let rounds = [] as Awaited<ReturnType<typeof getRoundTipStatusResponse>>["rounds"];
  let me = null as Awaited<ReturnType<typeof getLeaderboardSnapshot>>["rows"][number] | null;
  let todayPicks: HomeTodayPickRow[] = [];
  let firstMatches: HomeFirstMatchRow[] = [];

  try {
    const competitionId = await resolveCompetitionIdForSeason({
      season: CURRENT_SEASON,
      userId: user.id,
      supabase,
    });

    if (!competitionId) {
      initialMessage = "No competition found.";
    } else {
      const [{ data: profile }, roundStatus, leaderboard] = await Promise.all([
        supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle(),
        getRoundTipStatusResponse({
          competitionId,
          season: CURRENT_SEASON,
          userId: user.id,
          admin: false,
          includeChampionData: false,
          supabase,
        }),
        getLeaderboardSnapshot({
          season: CURRENT_SEASON,
          competitionId,
          preferCached: true,
          includeTrends: false,
          supabase,
        }),
      ]);

      const profileName = String(
        ((profile as { display_name?: string | null } | null)?.display_name ?? "")
      ).trim();
      if (profileName) {
        welcomeName = profileName;
      }

      rounds = roundStatus.rounds;
      me = leaderboard.rows.find((row) => row.user_id === user.id) ?? null;
      const primaryRound = resolvePrimaryRoundForHome(rounds, Date.now());
      const homeRoundId = String(primaryRound?.round_id ?? "").trim();

      if (homeRoundId.length > 0) {
        const { data: matchRows, error: matchError } = await supabase
          .from("matches")
          .select("id, round_id, commence_time_utc, home_team, away_team, winner_team, status")
          .eq("round_id", homeRoundId)
          .order("commence_time_utc", { ascending: true });

        if (!matchError) {
          const firstMatch = (matchRows ?? [])[0];
          if (firstMatch) {
            firstMatches = [
              {
                round_id: String(firstMatch.round_id ?? ""),
                round_number: primaryRound ? Number(primaryRound.round_number ?? 0) : undefined,
                match_id: String(firstMatch.id ?? ""),
                commence_time_utc: String(firstMatch.commence_time_utc ?? ""),
                home_team: String(firstMatch.home_team ?? ""),
                away_team: String(firstMatch.away_team ?? ""),
              },
            ];
          }

          const todayKey = melbourneDayKey(new Date());
          const todaysMatches = (matchRows ?? []).filter((match) => {
            return melbourneDayKey(String(match.commence_time_utc ?? "")) === todayKey;
          });

          const matchIds = todaysMatches.map((match) => String(match.id));
          const pickedTeamByMatchId = new Map<string, string>();

          if (matchIds.length > 0) {
            const { data: tipRows, error: tipError } = await supabase
              .from("tips")
              .select("match_id, picked_team")
              .eq("competition_id", competitionId)
              .eq("user_id", user.id)
              .in("match_id", matchIds);

            if (!tipError) {
              (tipRows ?? []).forEach((tip) => {
                pickedTeamByMatchId.set(String(tip.match_id), String(tip.picked_team ?? ""));
              });
            }
          }

          todayPicks = todaysMatches.map((match) => {
            const matchId = String(match.id);
            const picked = String(pickedTeamByMatchId.get(matchId) ?? "").trim();
            return {
              match_id: matchId,
              round_number: primaryRound ? Number(primaryRound.round_number ?? 0) : undefined,
              commence_time_utc: String(match.commence_time_utc ?? ""),
              home_team: String(match.home_team ?? ""),
              away_team: String(match.away_team ?? ""),
              picked_team: picked || null,
              winner_team: String(match.winner_team ?? "").trim() || null,
              status: String(match.status ?? "").trim() || null,
            };
          });
        }
      }
    }
  } catch (error) {
    initialMessage =
      error instanceof Error ? error.message : "Could not load dashboard.";
  }

  return (
    <HomePageClient
      welcomeName={welcomeName}
      rounds={rounds}
      me={me}
      todayPicks={todayPicks}
      firstMatches={firstMatches}
      initialMessage={initialMessage}
    />
  );
}

export default async function HomePage() {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return <LoginPage />;
  }

  const initialWelcomeName = fallbackWelcomeName(user);
  return (
    <Suspense fallback={<HomePageFallback welcomeName={initialWelcomeName} />}>
      <HomePageData user={user as HomeAuthedUser} initialWelcomeName={initialWelcomeName} />
    </Suspense>
  );
}
