import { redirect } from "next/navigation";
import HomePageClient from "@/components/HomePageClient";
import { createClient, createServiceClient } from "@/lib/supabase-server";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";
import { getRoundTipStatusResponse } from "@/lib/round-tip-status-data";
import { getLeaderboardSnapshot } from "@/lib/leaderboard-snapshot";

const CURRENT_SEASON = 2026;

type HomeTodayPickRow = {
  match_id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  picked_team: string | null;
  winner_team: string | null;
};

type HomeFirstMatchRow = {
  round_id: string;
  match_id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
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

export default async function HomePage() {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const supabase = createServiceClient();
  let welcomeName = fallbackWelcomeName(user);
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
          supabase,
        }),
        getLeaderboardSnapshot({
          season: CURRENT_SEASON,
          competitionId,
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

      const roundIds = Array.from(
        new Set(
          rounds
            .map((round) => String(round.round_id ?? "").trim())
            .filter((roundId) => roundId.length > 0)
        )
      );

      if (roundIds.length > 0) {
        const { data: matchRows, error: matchError } = await supabase
          .from("matches")
          .select("id, round_id, commence_time_utc, home_team, away_team, winner_team")
          .in("round_id", roundIds)
          .order("commence_time_utc", { ascending: true });

        if (!matchError) {
          const firstMatchByRoundId = new Map<string, HomeFirstMatchRow>();

          (matchRows ?? []).forEach((match) => {
            const roundId = String(match.round_id ?? "");
            if (!roundId || firstMatchByRoundId.has(roundId)) return;
            firstMatchByRoundId.set(roundId, {
              round_id: roundId,
              match_id: String(match.id),
              commence_time_utc: String(match.commence_time_utc ?? ""),
              home_team: String(match.home_team ?? ""),
              away_team: String(match.away_team ?? ""),
            });
          });

          firstMatches = Array.from(firstMatchByRoundId.values());

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
              commence_time_utc: String(match.commence_time_utc ?? ""),
              home_team: String(match.home_team ?? ""),
              away_team: String(match.away_team ?? ""),
              picked_team: picked || null,
              winner_team: String(match.winner_team ?? "").trim() || null,
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
