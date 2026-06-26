export type AdminAuditActionType =
  | "sync_fixture"
  | "sync_results"
  | "recalc_leaderboard"
  | "snapshot_odds_due"
  | "late_tip_override"
  | "member_updated"
  | "member_removed"
  | "payment_settings_updated"
  | "champion_settings_updated";

export type AdminAuditResultStatus = "success" | "skipped" | "failed";

type AdminAuditEventParams = {
  competitionId: string;
  season?: number | null;
  actionType: AdminAuditActionType;
  resultStatus?: AdminAuditResultStatus;
  actorMode: "bearer" | "cron";
  actorUserId?: string | null;
  actorDisplayName?: string | null;
  targetType?: string | null;
  targetUserId?: string | null;
  targetLabel?: string | null;
  summary: string;
  requestPath?: string | null;
  details?: unknown;
};

type MemberAuditSnapshot = {
  display_name?: string | null;
  favorite_team?: string | null;
  role?: string | null;
  payment_status?: string | null;
  is_test_account?: boolean | null;
};

type SeasonChampionSelectionLike = {
  season: number;
  user_id: string | null;
};

function normalizeString(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text || null;
}

function boolLabel(value: boolean | null | undefined) {
  return value ? "on" : "off";
}

export function shortUserLabel(userId: string | null | undefined) {
  const raw = normalizeString(userId);
  if (!raw) return "Unknown member";
  return `${raw.slice(0, 8)}…`;
}

export function describeMemberAuditChanges(params: {
  before: MemberAuditSnapshot;
  after: MemberAuditSnapshot;
}) {
  const parts: string[] = [];
  const beforeDisplayName = normalizeString(params.before.display_name);
  const afterDisplayName = normalizeString(params.after.display_name);
  if (beforeDisplayName !== afterDisplayName) {
    parts.push(
      `display name ${beforeDisplayName ?? "blank"} -> ${afterDisplayName ?? "blank"}`
    );
  }

  const beforeRole = normalizeString(params.before.role) ?? "member";
  const afterRole = normalizeString(params.after.role) ?? "member";
  if (beforeRole !== afterRole) {
    parts.push(`role ${beforeRole} -> ${afterRole}`);
  }

  const beforeTeam = normalizeString(params.before.favorite_team) ?? "none";
  const afterTeam = normalizeString(params.after.favorite_team) ?? "none";
  if (beforeTeam !== afterTeam) {
    parts.push(`team ${beforeTeam} -> ${afterTeam}`);
  }

  const beforePayment = normalizeString(params.before.payment_status) ?? "pending";
  const afterPayment = normalizeString(params.after.payment_status) ?? "pending";
  if (beforePayment !== afterPayment) {
    parts.push(`payment ${beforePayment} -> ${afterPayment}`);
  }

  const beforeTest = Boolean(params.before.is_test_account);
  const afterTest = Boolean(params.after.is_test_account);
  if (beforeTest !== afterTest) {
    parts.push(`test account ${boolLabel(beforeTest)} -> ${boolLabel(afterTest)}`);
  }

  return parts;
}

export function describeChampionSeasonAuditChanges(params: {
  before: SeasonChampionSelectionLike[];
  after: SeasonChampionSelectionLike[];
}) {
  const beforeMap = new Map<number, string | null>();
  const afterMap = new Map<number, string | null>();

  params.before.forEach((entry) => {
    beforeMap.set(entry.season, normalizeString(entry.user_id));
  });
  params.after.forEach((entry) => {
    afterMap.set(entry.season, normalizeString(entry.user_id));
  });

  const seasons = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort((a, b) => a - b);
  const changes: string[] = [];

  for (const season of seasons) {
    const beforeUserId = beforeMap.get(season) ?? null;
    const afterUserId = afterMap.get(season) ?? null;
    if (beforeUserId === afterUserId) continue;
    if (!beforeUserId && afterUserId) {
      changes.push(`${season} set`);
    } else if (beforeUserId && !afterUserId) {
      changes.push(`${season} cleared`);
    } else {
      changes.push(`${season} changed`);
    }
  }

  return changes;
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export async function recordAdminAuditEvent(params: AdminAuditEventParams) {
  if (params.actorMode !== "bearer" || !params.actorUserId) {
    return null;
  }

  const { createServiceClient } = await import("./supabase-server");
  const supabase = createServiceClient();

  let actorDisplayName = normalizeString(params.actorDisplayName);
  if (!actorDisplayName) {
    const actorProfile = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", params.actorUserId)
      .maybeSingle();
    actorDisplayName = normalizeString(
      (actorProfile.data as { display_name?: string | null } | null)?.display_name
    );
  }

  const insert = await supabase.from("admin_audit_log").insert({
    competition_id: params.competitionId,
    season: params.season ?? null,
    action_type: params.actionType,
    result_status: params.resultStatus ?? "success",
    actor_mode: params.actorMode,
    actor_user_id: params.actorUserId,
    actor_display_name: actorDisplayName,
    target_type: normalizeString(params.targetType),
    target_user_id: normalizeString(params.targetUserId),
    target_label: normalizeString(params.targetLabel),
    summary: params.summary,
    request_path: normalizeString(params.requestPath),
    details: params.details ?? null,
  });

  if (!insert.error) return null;

  if (isMissingRelationError(insert.error.message, "admin_audit_log")) {
    return `${insert.error.message} (hint: apply migration db/migrations/20260407_admin_audit_log.sql)`;
  }

  return insert.error.message;
}
