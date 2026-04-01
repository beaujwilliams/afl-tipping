import { createServiceClient } from "@/lib/supabase-server";

export type ReigningChampionResult = {
  reigning_champion_user_id: string | null;
  champion_highlight_user_ids: string[];
  configured_champion_highlight_user_ids: string[];
  override_user_id: string | null;
  source: "override" | "season_champion" | "none";
  champion_season: number | null;
};

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function isMissingTableError(message: string, tableName: string) {
  const m = message.toLowerCase();
  const t = tableName.toLowerCase();
  return m.includes(t) && (m.includes("relation") || m.includes("does not exist") || m.includes("table"));
}

function normalizeUuidList(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export async function resolveReigningChampion(params: {
  competitionId: string;
  season?: number | null;
  supabase?: ReturnType<typeof createServiceClient>;
}): Promise<ReigningChampionResult> {
  const supabase = params.supabase ?? createServiceClient();

  let overrideUserId: string | null = null;
  let configuredHighlightUserIds: string[] = [];

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

  const compWithHighlights = await supabase
    .from("competitions")
    .select("champion_highlight_user_ids")
    .eq("id", params.competitionId)
    .single();

  if (!compWithHighlights.error) {
    configuredHighlightUserIds = normalizeUuidList(
      compWithHighlights.data?.champion_highlight_user_ids
    );
  } else if (
    !isMissingColumnError(compWithHighlights.error.message, "champion_highlight_user_ids")
  ) {
    // Unknown error: fail open and continue without configured highlights.
  }

  let reigningChampionUserId: string | null = null;
  let resolvedOverrideUserId: string | null = null;
  let source: "override" | "season_champion" | "none" = "none";
  let championSeason: number | null = null;

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

  if (!reigningChampionUserId) {
    let seasonChampRow: { season: number; user_id: string } | null = null;

    let q = supabase
      .from("season_champions")
      .select("season, user_id")
      .eq("competition_id", params.competitionId)
      .order("season", { ascending: false })
      .limit(1);

    const maybeSeason = params.season;
    if (Number.isFinite(Number(maybeSeason))) {
      const maxSeason = Number(maybeSeason) - 1;
      q = q.lte("season", maxSeason);
    }

    const seasonChamp = await q.maybeSingle();

    if (seasonChamp.error) {
      if (!isMissingTableError(seasonChamp.error.message, "season_champions")) {
        // Unknown error: fail open.
      }
    } else if (seasonChamp.data?.user_id) {
      seasonChampRow = {
        season: Number(seasonChamp.data.season),
        user_id: String(seasonChamp.data.user_id),
      };
    }

    if (seasonChampRow) {
      reigningChampionUserId = seasonChampRow.user_id;
      source = "season_champion";
      championSeason = seasonChampRow.season;
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

  pushHighlight(reigningChampionUserId);
  configuredHighlightUserIds.forEach((userId) => pushHighlight(userId));

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
      const filteredEffectiveIds = effectiveHighlightUserIds.filter((id) =>
        validIds.has(id)
      );
      const filteredConfiguredIds = configuredHighlightUserIds.filter((id) =>
        validIds.has(id)
      );

      effectiveHighlightUserIds.length = 0;
      effectiveHighlightUserIds.push(...filteredEffectiveIds);
      configuredHighlightUserIds = filteredConfiguredIds;
    }
  }

  return {
    reigning_champion_user_id: reigningChampionUserId,
    champion_highlight_user_ids: effectiveHighlightUserIds,
    configured_champion_highlight_user_ids: configuredHighlightUserIds,
    override_user_id: resolvedOverrideUserId,
    source,
    champion_season: championSeason,
  };
}
