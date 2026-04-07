import { redirect } from "next/navigation";
import RoundResultsDetailPageClient from "@/components/RoundResultsDetailPageClient";
import { getRoundResultsResponse } from "@/lib/round-results-data";
import { createClient, createServiceClient } from "@/lib/supabase-server";

type RoundResultsPageProps = {
  params: Promise<{
    season: string;
    round: string;
  }>;
};

export default async function RoundResultsPage(props: RoundResultsPageProps) {
  const { season: seasonParam, round: roundParam } = await props.params;
  const season = Number(seasonParam);
  const round = Number(roundParam);

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let initialData = null as Awaited<ReturnType<typeof getRoundResultsResponse>> | null;
  let initialMessage: string | null = null;

  if (!Number.isFinite(season) || !Number.isFinite(round) || round < 0) {
    initialMessage = "Invalid season/round.";
  } else {
    try {
      initialData = await getRoundResultsResponse({
        season,
        round,
        userId: user.id,
        supabase: createServiceClient(),
      });
    } catch (error) {
      initialMessage =
        error instanceof Error ? error.message : "Could not load round results.";
    }
  }

  return (
    <RoundResultsDetailPageClient
      season={season}
      round={round}
      currentUserId={user.id}
      initialData={initialData}
      initialMessage={initialMessage}
    />
  );
}
