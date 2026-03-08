import { createServiceClient } from "@/lib/supabase-server";

export type ReigningChampionResult = {
  reigning_champion_user_id: string | null;
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

export async function resolveReigningChampion(params: {
  competitionId: string;
  season?: number | null;
  supabase?: ReturnType<typeof createServiceClient>;
}): Promise<ReigningChampionResult> {
  const supabase = params.supabase ?? createServiceClient();

  let overrideUserId: string | null = null;

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

  if (overrideUserId) {
    const memberCheck = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", params.competitionId)
      .eq("user_id", overrideUserId)
      .maybeSingle();

    if (!memberCheck.error && memberCheck.data?.user_id) {
      return {
        reigning_champion_user_id: overrideUserId,
        override_user_id: overrideUserId,
        source: "override",
        champion_season: null,
      };
    }

    if (memberCheck.error) {
      // Unknown membership error: fail open and keep override.
      return {
        reigning_champion_user_id: overrideUserId,
        override_user_id: overrideUserId,
        source: "override",
        champion_season: null,
      };
    }

    // Override points to a user no longer in this competition; ignore and fall back.
    overrideUserId = null;
  }

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
    return {
      reigning_champion_user_id: seasonChampRow.user_id,
      override_user_id: null,
      source: "season_champion",
      champion_season: seasonChampRow.season,
    };
  }

  return {
    reigning_champion_user_id: null,
    override_user_id: null,
    source: "none",
    champion_season: null,
  };
}
