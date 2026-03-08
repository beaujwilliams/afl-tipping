import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";

type MembershipRoleRow = {
  role: string | null;
};

type AdminMembershipRow = {
  competition_id: string;
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getBearer(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

async function getUserIdFromToken(token: string): Promise<string | null> {
  const authClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data } = await authClient.auth.getUser(token);
  return data.user?.id ?? null;
}

export async function getUserIdFromBearer(req: Request): Promise<string | null> {
  const token = getBearer(req);
  if (!token) return null;
  return getUserIdFromToken(token);
}

export async function getDefaultCompetitionId(
  supabase = createServiceClient()
): Promise<string | null> {
  const { data: comp, error } = await supabase
    .from("competitions")
    .select("id")
    .limit(1)
    .single();

  if (error || !comp?.id) return null;
  return String(comp.id);
}

export async function getPreferredAdminCompetitionIdForUser(params: {
  userId: string;
  supabase?: ReturnType<typeof createServiceClient>;
}): Promise<string | null> {
  const supabase = params.supabase ?? createServiceClient();

  const { data: adminMemberships, error } = await supabase
    .from("memberships")
    .select("competition_id")
    .eq("user_id", params.userId)
    .in("role", ["owner", "admin"]);

  if (error || !adminMemberships?.length) return null;

  const competitionIds = Array.from(
    new Set(
      (adminMemberships as AdminMembershipRow[]).map((r) =>
        String(r.competition_id)
      )
    )
  );

  if (competitionIds.length === 1) return competitionIds[0];

  const { data: memberRows, error: countErr } = await supabase
    .from("memberships")
    .select("competition_id")
    .in("competition_id", competitionIds);

  if (countErr || !memberRows) {
    return competitionIds.sort((a, b) => a.localeCompare(b))[0] ?? null;
  }

  const counts: Record<string, number> = {};
  competitionIds.forEach((id) => {
    counts[id] = 0;
  });

  for (const row of memberRows as AdminMembershipRow[]) {
    const id = String(row.competition_id);
    if (!(id in counts)) continue;
    counts[id] += 1;
  }

  return competitionIds.sort((a, b) => {
    const countDiff = (counts[b] ?? 0) - (counts[a] ?? 0);
    if (countDiff !== 0) return countDiff;
    return a.localeCompare(b);
  })[0] ?? null;
}

export async function resolveCompetitionIdForAdminRequest(
  req: Request,
  supabase = createServiceClient()
): Promise<string | null> {
  const url = new URL(req.url);
  const fromQS = url.searchParams.get("competition_id")?.trim();
  if (fromQS) return fromQS;

  const userId = await getUserIdFromBearer(req);
  if (userId) {
    const preferred = await getPreferredAdminCompetitionIdForUser({
      userId,
      supabase,
    });
    if (preferred) return preferred;
  }

  return getDefaultCompetitionId(supabase);
}

export async function userHasAdminRole(params: {
  userId: string;
  competitionId: string;
  supabase?: ReturnType<typeof createServiceClient>;
}): Promise<boolean> {
  const supabase = params.supabase ?? createServiceClient();

  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("competition_id", params.competitionId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error || !data) return false;

  const role = String((data as MembershipRoleRow).role ?? "")
    .trim()
    .toLowerCase();

  return role === "owner" || role === "admin";
}

export async function isAdminBearerForCompetition(
  req: Request,
  competitionId: string
): Promise<boolean> {
  const token = getBearer(req);
  if (!token) return false;

  const userId = await getUserIdFromToken(token);
  if (!userId) return false;

  return userHasAdminRole({ userId, competitionId });
}

type AdminGateOkCron = {
  ok: true;
  mode: "cron";
  secret: string;
};

type AdminGateOkBearer = {
  ok: true;
  mode: "bearer";
  token: string;
  userId: string;
  competitionId: string;
};

type AdminGateDenied = {
  ok: false;
  status: number;
  json: { error: string };
};

export type RequireAdminOrCronResult =
  | AdminGateOkCron
  | AdminGateOkBearer
  | AdminGateDenied;

export async function requireAdminOrCron(
  req: Request,
  opts?: { competitionId?: string | null }
): Promise<RequireAdminOrCronResult> {
  const url = new URL(req.url);

  const secret = url.searchParams.get("secret") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && secret && secret === cronSecret) {
    return { ok: true, mode: "cron", secret };
  }

  const token = getBearer(req);
  if (cronSecret && token && token === cronSecret) {
    return { ok: true, mode: "cron", secret: cronSecret };
  }
  if (!token) {
    return { ok: false, status: 401, json: { error: "Missing Bearer token" } };
  }

  const userId = await getUserIdFromToken(token);
  if (!userId) {
    return { ok: false, status: 401, json: { error: "Invalid session" } };
  }

  const supabase = createServiceClient();
  let competitionId = opts?.competitionId ?? null;
  if (!competitionId) {
    competitionId = await getPreferredAdminCompetitionIdForUser({
      userId,
      supabase,
    });
  }
  if (!competitionId) {
    competitionId = await getDefaultCompetitionId(supabase);
  }

  if (!competitionId) {
    return { ok: false, status: 404, json: { error: "No competition found" } };
  }

  const isAdmin = await userHasAdminRole({ userId, competitionId, supabase });
  if (!isAdmin) {
    return { ok: false, status: 403, json: { error: "Admin only" } };
  }

  return { ok: true, mode: "bearer", token, userId, competitionId };
}
