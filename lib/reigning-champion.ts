import { createServiceClient } from "@/lib/supabase-server";
import { buildChampionSeasonsByUserId, getLatestSeasonChampion, loadSeasonChampions } from "@/lib/season-champions";

export type ReigningChampionResult = {
  reigning_champion_user_id: string | null;
  champion_highlight_user_ids: string[];
  configured_champion_highlight_user_ids: string[];
  champion_seasons_by_user_id: Record<string, number[]>;
  override_user_id: string | null;
  source: "override" | "season_champion" | "none";
  champion_season: number | null;
};

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

export async function resolveReigningChampion(params: {
  competitionId: string;
  season?: number | null;
  supabase?: ReturnType<typeof createServiceClient>;
}): Promise<ReigningChampionResult> {
  const supabase = params.supabase ?? createServiceClient();

  let overrideUserId: string | null = null;
  let championSeasonsByUserId: Record<string, number[]> = {};
  let latestSeasonChampion: { season: number; user_id: string | null } | null = null;

  const compWithOverride = await supabase
    .from("competitions")
    .select("reigning_champion_override_user_id")
    .eq("id", params.competitionId)
    .single();

  if (
    !compWithOverride.error &&
    compWithOverride.data?.reigning_champion_override_user_id
  ) {
    overrideUserId = String(compWithOverride.data.reigning_champion_override_user_id);
  } else if (
    compWithOverride.error &&
    !isMissingColumnError(compWithOverride.error.message, "reigning_champion_override_user_id")
  ) {
    // Unknown error: fail open and continue without override.
  }

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
  let resolvedOverrideUserId: string | null = null;
  let source: "override" | "season_champion" | "none" = "none";
  let championSeason: number | null = null;

  if (latestSeasonChampion?.user_id) {
    reigningChampionUserId = latestSeasonChampion.user_id;
    championSeason = latestSeasonChampion.season;
    source = "season_champion";
  }

  if (overrideUserId && !reigningChampionUserId) {
    const memberCheck = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", params.competitionId)
      .eq("user_id", overrideUserId)
      .maybeSingle();

    if (!memberCheck.error && memberCheck.data?.user_id) {
      reigningChampionUserId = overrideUserId;
      resolvedOverrideUserId = overrideUserId;
      source = "override";
    }

    if (!reigningChampionUserId && memberCheck.error) {
      // Unknown membership error: fail open and keep override.
      reigningChampionUserId = overrideUserId;
      resolvedOverrideUserId = overrideUserId;
      source = "override";
    }

    // Override points to a user no longer in this competition; ignore and fall back.
    if (!reigningChampionUserId) {
      overrideUserId = null;
    }
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
    override_user_id: resolvedOverrideUserId,
    source,
    champion_season: championSeason,
  };
}
