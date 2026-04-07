import { redirect } from "next/navigation";
import RoundPageClient from "@/components/RoundPageClient";
import { getRoundPageInitialData } from "@/lib/round-page-data";
import { createClient, createServiceClient } from "@/lib/supabase-server";

type RoundPageProps = {
  params: Promise<{
    season: string;
    round: string;
  }>;
};

export default async function RoundPage(props: RoundPageProps) {
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

  let initialData = null;
  let initialMessage: string | null = null;

  if (!Number.isFinite(season) || !Number.isFinite(round)) {
    initialMessage = "Invalid season/round.";
  } else {
    const result = await getRoundPageInitialData({
      season,
      round,
      userId: user.id,
      supabase: createServiceClient(),
    });
    initialData = result.initialData;
    initialMessage = result.initialMessage;
  }

  return (
    <RoundPageClient
      season={season}
      round={round}
      initialData={initialData}
      initialMessage={initialMessage}
    />
  );
}
