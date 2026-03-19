import { redirect } from "next/navigation";
import HomePageClient from "@/components/HomePageClient";
import { createClient, createServiceClient } from "@/lib/supabase-server";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";
import { getRoundTipStatusResponse } from "@/lib/round-tip-status-data";
import { getLeaderboardSnapshot } from "@/lib/leaderboard-snapshot";

const CURRENT_SEASON = 2026;

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
      initialMessage={initialMessage}
    />
  );
}
