import { createServiceClient } from "@/lib/supabase-server";
import { buildChampionSeasonsByUserId, getLatestSeasonChampion, loadSeasonChampions } from "@/lib/season-champions";

export type ReigningChampionResult = {
  reigning_champion_user_id: string | null;
  champion_highlight_user_ids: string[];
  configured_champion_highlight_user_ids: string[];
  champion_seasons_by_user_id: Record<string, number[]>;
  override_user_id: string | null;
  source: "season_champion" | "none";
  champion_season: number | null;
};

export async function resolveReigningChampion(params: {
  competitionId: string;
  season?: number | null;
  supabase?: ReturnType<typeof createServiceClient>;
}): Promise<ReigningChampionResult> {
  const supabase = params.supabase ?? createServiceClient();

  let championSeasonsByUserId: Record<string, number[]> = {};
  let latestSeasonChampion: { season: number; user_id: string | null } | null = null;

  try {
    const seasonChampions = await loadSeasonChampions({
      competitionId: params.competitionId,
      supabase,
    });
    championSeasonsByUserId = buildChampionSeasonsByUserId(seasonChampions.rows);
    latestSeasonChampion = getLatestSeasonChampion(seasonChampions.rows, params.season);
  } catch {
    // Unknown season champion error: fail open and continue without historical champions.
  }

  let reigningChampionUserId: string | null = null;
  let source: "season_champion" | "none" = "none";
  let championSeason: number | null = null;

  if (latestSeasonChampion?.user_id) {
    reigningChampionUserId = latestSeasonChampion.user_id;
    championSeason = latestSeasonChampion.season;
    source = "season_champion";
  }

  const effectiveHighlightUserIds: string[] = [];
  const seenHighlightIds = new Set<string>();
  const pushHighlight = (userId: string | null) => {
    const id = String(userId ?? "").trim();
    if (!id || seenHighlightIds.has(id)) return;
    seenHighlightIds.add(id);
    effectiveHighlightUserIds.push(id);
  };

  Object.keys(championSeasonsByUserId).forEach((userId) => pushHighlight(userId));
  pushHighlight(reigningChampionUserId);

  if (effectiveHighlightUserIds.length > 0) {
    const memberRows = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", params.competitionId)
      .in("user_id", effectiveHighlightUserIds);

    if (!memberRows.error) {
      const validIds = new Set(
        (memberRows.data ?? []).map((row) => String(row.user_id))
      );
      const filteredChampionSeasonsByUserId = Object.fromEntries(
        Object.entries(championSeasonsByUserId).filter(([userId]) => validIds.has(userId))
      );
      const filteredEffectiveIds = effectiveHighlightUserIds.filter((id) =>
        validIds.has(id)
      );

      effectiveHighlightUserIds.length = 0;
      effectiveHighlightUserIds.push(...filteredEffectiveIds);
      championSeasonsByUserId = filteredChampionSeasonsByUserId;
    }
  }

  return {
    reigning_champion_user_id: reigningChampionUserId,
    champion_highlight_user_ids: effectiveHighlightUserIds,
    configured_champion_highlight_user_ids: [],
    champion_seasons_by_user_id: championSeasonsByUserId,
    override_user_id: null,
    source,
    champion_season: championSeason,
  };
}
