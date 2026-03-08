import { createServiceClient } from "@/lib/supabase-server";
import { getDefaultCompetitionId } from "@/lib/admin-auth";

type CompetitionRow = {
  competition_id: string;
};

function pickMostFrequentCompetition(rows: CompetitionRow[]) {
  if (!rows.length) return null;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.competition_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  })[0]?.[0] ?? null;
}

export async function getUserCompetitionIds(params: {
  userId: string;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  const { data, error } = await supabase
    .from("memberships")
    .select("competition_id")
    .eq("user_id", params.userId);

  if (error || !data) return [] as string[];

  return Array.from(
    new Set((data as CompetitionRow[]).map((r) => String(r.competition_id)))
  ).sort((a, b) => a.localeCompare(b));
}

export async function resolveCompetitionIdForSeason(params: {
  season: number;
  explicitCompetitionId?: string | null;
  userId?: string | null;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  if (params.explicitCompetitionId?.trim()) {
    return params.explicitCompetitionId.trim();
  }

  const candidateIds =
    params.userId && params.userId.trim()
      ? await getUserCompetitionIds({ userId: params.userId.trim(), supabase })
      : [];

  let q = supabase.from("rounds").select("competition_id").eq("season", params.season);
  if (candidateIds.length) {
    q = q.in("competition_id", candidateIds);
  }

  const { data: roundRows, error } = await q;
  if (!error && roundRows?.length) {
    const picked = pickMostFrequentCompetition(roundRows as CompetitionRow[]);
    if (picked) return picked;
  }

  if (candidateIds.length) return candidateIds[0];

  return getDefaultCompetitionId(supabase);
}

export async function resolveCompetitionIdForSeasonRound(params: {
  season: number;
  round: number;
  explicitCompetitionId?: string | null;
  userId?: string | null;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  if (params.explicitCompetitionId?.trim()) {
    return params.explicitCompetitionId.trim();
  }

  const candidateIds =
    params.userId && params.userId.trim()
      ? await getUserCompetitionIds({ userId: params.userId.trim(), supabase })
      : [];

  let q = supabase
    .from("rounds")
    .select("competition_id")
    .eq("season", params.season)
    .eq("round_number", params.round);

  if (candidateIds.length) {
    q = q.in("competition_id", candidateIds);
  }

  const { data: roundRows, error } = await q;
  if (!error && roundRows?.length) {
    const picked = pickMostFrequentCompetition(roundRows as CompetitionRow[]);
    if (picked) return picked;
  }

  return resolveCompetitionIdForSeason({
    season: params.season,
    explicitCompetitionId: params.explicitCompetitionId,
    userId: params.userId,
    supabase,
  });
}

