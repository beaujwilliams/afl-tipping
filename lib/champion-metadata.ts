export type SeasonChampionSelection = {
  season: number;
  user_id: string | null;
};

export type ChampionSeasonsByUserId = Record<string, number[]>;

export function normalizeSeasonChampionSelections(value: unknown): SeasonChampionSelection[] {
  if (!Array.isArray(value)) return [];

  const bySeason = new Map<number, string | null>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rawSeason = Number((item as { season?: unknown }).season);
    if (!Number.isFinite(rawSeason)) continue;

    const season = Math.trunc(rawSeason);
    if (season < 2000 || season > 2100) continue;

    const rawUserId = (item as { user_id?: unknown }).user_id;
    const userId =
      typeof rawUserId === "string" && rawUserId.trim().length > 0
        ? rawUserId.trim()
        : null;

    bySeason.set(season, userId);
  }

  return Array.from(bySeason.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([season, user_id]) => ({ season, user_id }));
}

export function sameSeasonChampionSelections(
  a: SeasonChampionSelection[],
  b: SeasonChampionSelection[]
) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].season !== b[i].season) return false;
    if ((a[i].user_id ?? null) !== (b[i].user_id ?? null)) return false;
  }
  return true;
}

export function editableChampionSeasons(
  currentSeason: number,
  selections: SeasonChampionSelection[]
) {
  const seasons = new Set<number>();
  if (Number.isFinite(currentSeason - 1)) seasons.add(currentSeason - 1);
  if (Number.isFinite(currentSeason)) seasons.add(currentSeason);
  selections.forEach((entry) => {
    if (Number.isFinite(entry.season)) seasons.add(entry.season);
  });
  return Array.from(seasons)
    .filter((season) => season >= 2000 && season <= 2100)
    .sort((a, b) => a - b);
}

export function normalizeChampionSeasonsByUserId(
  value: unknown
): ChampionSeasonsByUserId {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: ChampionSeasonsByUserId = {};
  for (const [userId, seasons] of Object.entries(value)) {
    const cleanUserId = userId.trim();
    if (!cleanUserId || !Array.isArray(seasons)) continue;

    const cleanSeasons = Array.from(
      new Set(
        seasons
          .map((season) => Number(season))
          .filter((season) => Number.isFinite(season))
          .map((season) => Math.trunc(season))
          .filter((season) => season >= 2000 && season <= 2100)
      )
    ).sort((a, b) => a - b);

    if (cleanSeasons.length > 0) {
      out[cleanUserId] = cleanSeasons;
    }
  }

  return out;
}

export function championSeasonLabels(seasons: number[] | null | undefined) {
  return Array.from(
    new Set(
      (seasons ?? [])
        .map((season) => Number(season))
        .filter((season) => Number.isFinite(season))
        .map((season) => Math.trunc(season))
        .filter((season) => season >= 2000 && season <= 2100)
    )
  )
    .sort((a, b) => a - b)
    .map((season) => `${season} champion`);
}
