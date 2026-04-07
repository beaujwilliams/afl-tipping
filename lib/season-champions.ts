import { createServiceClient } from "@/lib/supabase-server";
import type { ChampionSeasonsByUserId, SeasonChampionSelection } from "@/lib/champion-metadata";

export function isMissingSeasonChampionsTableError(message: string) {
  const m = String(message ?? "").toLowerCase();
  return m.includes("season_champions") && (m.includes("relation") || m.includes("table"));
}

export async function loadSeasonChampions(params: {
  competitionId: string;
  supabase?: ReturnType<typeof createServiceClient>;
}): Promise<{ rows: SeasonChampionSelection[]; tableAvailable: boolean }> {
  const supabase = params.supabase ?? createServiceClient();
  const { data, error } = await supabase
    .from("season_champions")
    .select("season, user_id")
    .eq("competition_id", params.competitionId)
    .order("season", { ascending: true });

  if (error) {
    if (isMissingSeasonChampionsTableError(error.message)) {
      return {
        rows: [] as SeasonChampionSelection[],
        tableAvailable: false,
      };
    }
    throw new Error(`Failed to load season champions: ${error.message}`);
  }

  const rows: SeasonChampionSelection[] = [];
  (data ?? []).forEach((row) => {
    const season = Math.trunc(Number(row.season));
    const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
    if (!Number.isFinite(season) || season < 2000 || season > 2100 || !userId) {
      return;
    }
    rows.push({ season, user_id: userId });
  });

  return { rows, tableAvailable: true };
}

export function buildChampionSeasonsByUserId(
  rows: SeasonChampionSelection[]
): ChampionSeasonsByUserId {
  const out: ChampionSeasonsByUserId = {};

  rows.forEach((row) => {
    const userId = String(row.user_id ?? "").trim();
    if (!userId) return;
    if (!out[userId]) out[userId] = [];
    out[userId].push(row.season);
  });

  for (const userId of Object.keys(out)) {
    out[userId] = Array.from(new Set(out[userId])).sort((a, b) => a - b);
  }

  return out;
}

export function getLatestSeasonChampion(
  rows: SeasonChampionSelection[],
  maxSeason?: number | null
) {
  const cappedRows = Number.isFinite(Number(maxSeason))
    ? rows.filter((row) => row.season <= Number(maxSeason))
    : rows;

  return cappedRows.length ? cappedRows[cappedRows.length - 1] : null;
}
