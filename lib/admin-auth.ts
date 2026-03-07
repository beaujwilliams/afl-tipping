import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";

type MembershipRoleRow = {
  role: string | null;
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
  if (!token) {
    return { ok: false, status: 401, json: { error: "Missing Bearer token" } };
  }

  const userId = await getUserIdFromToken(token);
  if (!userId) {
    return { ok: false, status: 401, json: { error: "Invalid session" } };
  }

  const supabase = createServiceClient();
  const competitionId =
    opts?.competitionId ?? (await getDefaultCompetitionId(supabase));

  if (!competitionId) {
    return { ok: false, status: 404, json: { error: "No competition found" } };
  }

  const isAdmin = await userHasAdminRole({ userId, competitionId, supabase });
  if (!isAdmin) {
    return { ok: false, status: 403, json: { error: "Admin only" } };
  }

  return { ok: true, mode: "bearer", token, userId, competitionId };
}
