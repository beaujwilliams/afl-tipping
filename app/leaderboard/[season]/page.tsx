import { redirect } from "next/navigation";
import LeaderboardPageClient from "@/components/LeaderboardPageClient";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";
import { getLeaderboardSnapshot } from "@/lib/leaderboard-snapshot";
import { createClient, createServiceClient } from "@/lib/supabase-server";

type LeaderboardPageProps = {
  params: Promise<{
    season: string;
  }>;
  searchParams: Promise<{
    group?: string;
  }>;
};

export default async function LeaderboardPage(props: LeaderboardPageProps) {
  const [{ season: seasonParam }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const season = Number(seasonParam);
  const initialViewMode = searchParams.group ? "groups" : "overall";

  if (!Number.isFinite(season)) {
    return (
      <LeaderboardPageClient
        season={season}
        initialLeaderboard={null}
        initialMessage="Invalid season."
        initialViewMode={initialViewMode}
      />
    );
  }

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const supabase = createServiceClient();
  let initialLeaderboard = null as Awaited<ReturnType<typeof getLeaderboardSnapshot>> | null;
  let initialMessage: string | null = null;

  try {
    const competitionId = await resolveCompetitionIdForSeason({
      season,
      userId: user.id,
      supabase,
    });

    if (!competitionId) {
      initialMessage = "No competition found.";
    } else {
      initialLeaderboard = await getLeaderboardSnapshot({
        season,
        competitionId,
        supabase,
        includeTrends: false,
      });
    }
  } catch (error) {
    initialMessage =
      error instanceof Error ? error.message : "Could not load leaderboard.";
  }

  return (
    <LeaderboardPageClient
      season={season}
      initialLeaderboard={initialLeaderboard}
      initialMessage={initialMessage}
      initialViewMode={initialViewMode}
    />
  );
}
