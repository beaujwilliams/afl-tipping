import { redirect } from "next/navigation";
import SeasonRoundsPageClient from "@/components/SeasonRoundsPageClient";
import { createClient, createServiceClient } from "@/lib/supabase-server";
import { userHasAdminRole } from "@/lib/admin-auth";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";
import { normalizeChampionSeasonsByUserId } from "@/lib/champion-metadata";
import { getRoundTipStatusResponse } from "@/lib/round-tip-status-data";

type SeasonRoundsPageProps = {
  params: Promise<{
    season: string;
  }>;
};

export default async function SeasonRoundsPage(props: SeasonRoundsPageProps) {
  const { season: seasonParam } = await props.params;
  const season = Number(seasonParam);

  if (!Number.isFinite(season)) {
    return (
      <SeasonRoundsPageClient
        season={season}
        rows={[]}
        statusByRoundId={{}}
        isAdmin={false}
        championHighlightUserIds={[]}
        championSeasonsByUserId={{}}
        initialMessage="Invalid season."
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
  let rows: Array<{
    id: string;
    round_number: number;
    lock_time_utc: string | null;
  }> = [];
  let statusByRoundId: Record<string, Awaited<ReturnType<typeof getRoundTipStatusResponse>>["rounds"][number]> = {};
  let isAdmin = false;
  let championHighlightUserIds: string[] = [];
  let championSeasonsByUserId: Record<string, number[]> = {};
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
      const admin = await userHasAdminRole({
        userId: user.id,
        competitionId,
        supabase,
      });

      const payload = await getRoundTipStatusResponse({
        competitionId,
        season,
        userId: user.id,
        admin,
        supabase,
      });

      rows = payload.rounds.map((round) => ({
        id: round.round_id,
        round_number: round.round_number,
        lock_time_utc: round.lock_time_utc,
      }));

      statusByRoundId = Object.fromEntries(
        payload.rounds.map((round) => [round.round_id, round])
      );
      isAdmin = payload.admin;
      championHighlightUserIds = Array.isArray(payload.champion_highlight_user_ids)
        ? payload.champion_highlight_user_ids
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean)
        : [];
      if (
        typeof payload.reigning_champion_user_id === "string" &&
        payload.reigning_champion_user_id.trim()
      ) {
        const reigningChampionUserId = payload.reigning_champion_user_id.trim();
        if (!championHighlightUserIds.includes(reigningChampionUserId)) {
          championHighlightUserIds.unshift(reigningChampionUserId);
        }
      }
      championSeasonsByUserId = normalizeChampionSeasonsByUserId(
        payload.champion_seasons_by_user_id
      );
    }
  } catch (error) {
    initialMessage =
      error instanceof Error ? error.message : "Could not load tip rounds.";
  }

  return (
    <SeasonRoundsPageClient
      season={season}
      rows={rows}
      statusByRoundId={statusByRoundId}
      isAdmin={isAdmin}
      championHighlightUserIds={championHighlightUserIds}
      championSeasonsByUserId={championSeasonsByUserId}
      initialMessage={initialMessage}
    />
  );
}
