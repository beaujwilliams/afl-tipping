import { NextResponse } from "next/server";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";
import { createServiceClient } from "@/lib/supabase-server";

type AuditRow = {
  id: string;
  competition_id: string;
  season: number | null;
  action_type: string;
  result_status: string;
  actor_mode: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  target_type: string | null;
  target_user_id: string | null;
  target_label: string | null;
  summary: string;
  request_path: string | null;
  details: unknown;
  created_at: string;
};

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const seasonParam = url.searchParams.get("season");
    const season = seasonParam ? Number(seasonParam) : null;
    const limitParam = Number(url.searchParams.get("limit") ?? "80");
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(200, Math.trunc(limitParam)))
      : 80;
    const actionType = String(url.searchParams.get("action_type") ?? "")
      .trim()
      .toLowerCase();

    const supabase = createServiceClient();
    const competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await resolveCompetitionIdForAdminRequest(req, supabase);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    let query = supabase
      .from("admin_audit_log")
      .select(
        "id, competition_id, season, action_type, result_status, actor_mode, actor_user_id, actor_display_name, target_type, target_user_id, target_label, summary, request_path, details, created_at"
      )
      .eq("competition_id", competitionId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (Number.isFinite(season)) {
      query = query.or(`season.eq.${season},season.is.null`);
    }

    if (actionType) {
      query = query.eq("action_type", actionType);
    }

    const rows = await query;
    if (rows.error) {
      if (isMissingRelationError(rows.error.message, "admin_audit_log")) {
        return NextResponse.json(
          {
            error: "admin_audit_log table missing or inaccessible",
            details: rows.error.message,
            hint: "Apply migration db/migrations/20260407_admin_audit_log.sql",
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { error: "Failed to load audit log", details: rows.error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      season: Number.isFinite(season) ? season : null,
      competition_id: competitionId,
      action_type: actionType || null,
      rows: (rows.data ?? []) as AuditRow[],
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "Unexpected error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
