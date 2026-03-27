import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase-server";
import { getBearer } from "@/lib/admin-auth";

type RoundCompetitionRow = {
  competition_id: string;
};

type MembershipCompetitionRow = {
  competition_id: string;
};

type MembershipUserRow = {
  user_id: string;
  is_test_account?: boolean | null;
};

type ProfileNameRow = {
  id: string;
  display_name: string | null;
};

export type CompetitionMemberOption = {
  user_id: string;
  display_name: string;
};

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function safeDisplayName(name: string | null | undefined, userId: string) {
  const n = String(name ?? "").trim();
  if (n) return n;
  return `${userId.slice(0, 8)}...`;
}

function isMissingColumnError(message: string, columnName: string) {
  const m = String(message ?? "").toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

function isMissingSchemaCacheTableError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return (
    m.includes("schema cache") &&
    (m.includes(rel) || m.includes(`public.${rel}`)) &&
    m.includes("could not find the table")
  );
}

export function isMissingLeaderboardGroupsTableError(message: string, code?: string) {
  const normalizedCode = String(code ?? "").toUpperCase();
  const names = [
    "leaderboard_groups",
    "leaderboard_group_members",
    "leaderboard_group_invites",
  ];
  return (
    normalizedCode === "PGRST205" ||
    names.some((name) => {
      return (
        isMissingRelationError(message, name) ||
        isMissingSchemaCacheTableError(message, name)
      );
    })
  );
}

function pickCompetitionIdForSeason(roundRows: RoundCompetitionRow[]) {
  if (!roundRows.length) return null;

  const byCompetition = new Map<string, number>();
  for (const row of roundRows) {
    const competitionId = String(row.competition_id);
    byCompetition.set(competitionId, (byCompetition.get(competitionId) ?? 0) + 1);
  }

  const picked = Array.from(byCompetition.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  })[0];

  return picked?.[0] ?? null;
}

async function getUserFromBearer(req: Request) {
  const token = getBearer(req);
  if (!token) return null;

  const authClient = createSupabaseClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export async function getAuthedUser(req: Request) {
  const fromBearer = await getUserFromBearer(req);
  if (fromBearer) return fromBearer;

  const authClient = await createClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export async function resolveCompetitionIdForSeason(params: {
  season: number;
  userId?: string | null;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  const { data: seasonRounds, error: roundsErr } = await supabase
    .from("rounds")
    .select("competition_id")
    .eq("season", params.season);

  if (roundsErr) {
    throw new Error(`Failed to read rounds: ${roundsErr.message}`);
  }

  const fromRounds = pickCompetitionIdForSeason(
    (seasonRounds ?? []) as RoundCompetitionRow[]
  );
  if (fromRounds) return fromRounds;

  if (params.userId) {
    const { data: memberships, error: mErr } = await supabase
      .from("memberships")
      .select("competition_id")
      .eq("user_id", params.userId);

    if (mErr) {
      throw new Error(`Failed to read memberships: ${mErr.message}`);
    }

    const candidate = Array.from(
      new Set(
        ((memberships ?? []) as MembershipCompetitionRow[]).map((row) =>
          String(row.competition_id)
        )
      )
    ).sort((a, b) => a.localeCompare(b))[0];

    if (candidate) return candidate;
  }

  const { data: comp, error: cErr } = await supabase
    .from("competitions")
    .select("id")
    .limit(1)
    .single();

  if (cErr || !comp?.id) return null;
  return String(comp.id);
}

export async function userIsCompetitionMember(params: {
  competitionId: string;
  userId: string;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("competition_id", params.competitionId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to verify membership: ${error.message}`);
  }

  return Boolean(data?.user_id);
}

export async function getCompetitionMemberDirectory(params: {
  competitionId: string;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = params.supabase ?? createServiceClient();

  let members: MembershipUserRow[] = [];
  const withTestFlag = await supabase
    .from("memberships")
    .select("user_id, is_test_account")
    .eq("competition_id", params.competitionId);

  if (
    withTestFlag.error &&
    isMissingColumnError(withTestFlag.error.message, "is_test_account")
  ) {
    const fallback = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", params.competitionId);

    if (fallback.error) {
      throw new Error(`Failed to read memberships: ${fallback.error.message}`);
    }

    members = (fallback.data ?? []) as MembershipUserRow[];
  } else if (withTestFlag.error) {
    throw new Error(`Failed to read memberships: ${withTestFlag.error.message}`);
  } else {
    members = (withTestFlag.data ?? []) as MembershipUserRow[];
  }

  const userIds = Array.from(
    new Set(
      members
        .filter((row) => !Boolean(row.is_test_account))
        .map((row) => String(row.user_id))
        .filter((id) => id.length > 0)
    )
  );

  if (!userIds.length) return [] as CompetitionMemberOption[];

  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);

  if (pErr) {
    throw new Error(`Failed to read profiles: ${pErr.message}`);
  }

  const profileById = new Map<string, string>();
  ((profiles ?? []) as ProfileNameRow[]).forEach((profile) => {
    profileById.set(String(profile.id), safeDisplayName(profile.display_name, String(profile.id)));
  });

  const rows = userIds.map((userId) => ({
    user_id: userId,
    display_name: profileById.get(userId) ?? safeDisplayName(null, userId),
  }));

  rows.sort((a, b) =>
    a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" })
  );
  return rows;
}
