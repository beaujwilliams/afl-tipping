import { NextResponse } from "next/server";
import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";

type CompetitionWithLock = {
  id: string;
  enforce_unpaid_tip_lock: boolean | null;
};

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

async function getCompetitionId(
  supabase: ReturnType<typeof createServiceClient>,
  req: Request
) {
  return resolveCompetitionIdForAdminRequest(req, supabase);
}

export async function GET(req: Request) {
  try {
    const supabase = createServiceClient();
    const competitionId = await getCompetitionId(supabase, req);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const admin = await requireAdminOrCron(req, { competitionId });
    if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });

    const withLock = await supabase
      .from("competitions")
      .select("id, enforce_unpaid_tip_lock")
      .eq("id", competitionId)
      .single();

    if (!withLock.error) {
      const row = (withLock.data as CompetitionWithLock | null) ?? null;
      return NextResponse.json({
        ok: true,
        competition_id: competitionId,
        enforce_unpaid_tip_lock: !!row?.enforce_unpaid_tip_lock,
      });
    }

    if (!isMissingColumnError(withLock.error.message, "enforce_unpaid_tip_lock")) {
      return NextResponse.json(
        { error: "Failed to load payment settings", details: withLock.error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      competition_id: competitionId,
      enforce_unpaid_tip_lock: false,
      note: "enforce_unpaid_tip_lock column missing; defaults to disabled.",
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Unexpected error", details },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as null | {
      enforce_unpaid_tip_lock?: boolean;
    };

    if (typeof body?.enforce_unpaid_tip_lock !== "boolean") {
      return NextResponse.json(
        { error: "enforce_unpaid_tip_lock must be a boolean" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const competitionId = await getCompetitionId(supabase, req);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const admin = await requireAdminOrCron(req, { competitionId });
    if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });
    const actorUserId = admin.mode === "bearer" ? admin.userId : null;

    const check = await supabase
      .from("competitions")
      .select("enforce_unpaid_tip_lock")
      .eq("id", competitionId)
      .single();

    if (check.error && isMissingColumnError(check.error.message, "enforce_unpaid_tip_lock")) {
      return NextResponse.json(
        {
          error: "Database is missing competitions.enforce_unpaid_tip_lock",
          details: "Run db/migrations/20260308_competitions_unpaid_tip_lock.sql and redeploy.",
        },
        { status: 500 }
      );
    }

    if (check.error) {
      return NextResponse.json(
        { error: "Failed to read payment settings", details: check.error.message },
        { status: 500 }
      );
    }

    const { error } = await supabase
      .from("competitions")
      .update({ enforce_unpaid_tip_lock: body.enforce_unpaid_tip_lock })
      .eq("id", competitionId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to save payment settings", details: error.message },
        { status: 500 }
      );
    }

    const previousValue = !!((check.data as CompetitionWithLock | null)?.enforce_unpaid_tip_lock);
    const auditError = await recordAdminAuditEvent({
      competitionId,
      actionType: "payment_settings_updated",
      actorMode: admin.mode,
      actorUserId,
      targetType: "competition",
      targetLabel: "Unpaid tip lock",
      summary: `Set unpaid tip lock ${body.enforce_unpaid_tip_lock ? "enabled" : "disabled"}.`,
      requestPath: new URL(req.url).pathname + new URL(req.url).search,
      details: {
        before: {
          enforce_unpaid_tip_lock: previousValue,
        },
        after: {
          enforce_unpaid_tip_lock: body.enforce_unpaid_tip_lock,
        },
      },
    });
    if (auditError) {
      console.warn("admin audit log failed after payment settings update", auditError);
    }

    return NextResponse.json({
      ok: true,
      competition_id: competitionId,
      enforce_unpaid_tip_lock: body.enforce_unpaid_tip_lock,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Unexpected error", details },
      { status: 500 }
    );
  }
}
