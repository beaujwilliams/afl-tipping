import { NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/admin-auth";
import { createServiceClient } from "@/lib/supabase-server";

function parseDismissHours(raw: unknown) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(24 * 7, Math.trunc(parsed)));
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });
    if (gate.mode !== "bearer") {
      return NextResponse.json(
        { error: "Manual anomaly dismiss is admin-only (bearer)." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => null)) as
      | {
          season?: unknown;
          dismiss_key?: unknown;
          hours?: unknown;
        }
      | null;

    const season = Number(body?.season ?? "2026");
    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    const dismissKey = String(body?.dismiss_key ?? "").trim();
    if (!dismissKey) {
      return NextResponse.json({ error: "dismiss_key is required" }, { status: 400 });
    }
    if (dismissKey.length > 180) {
      return NextResponse.json({ error: "dismiss_key is too long" }, { status: 400 });
    }

    const dismissHours = parseDismissHours(body?.hours);
    const expiresAtUtc = new Date(Date.now() + dismissHours * 60 * 60 * 1000).toISOString();

    const supabase = createServiceClient();
    const upsert = await supabase.from("admin_anomaly_dismissals").upsert(
      {
        competition_id: gate.competitionId,
        season,
        dismiss_key: dismissKey,
        dismissed_by_user_id: gate.userId,
        dismissed_at_utc: new Date().toISOString(),
        expires_at_utc: expiresAtUtc,
      },
      { onConflict: "competition_id,season,dismiss_key" }
    );

    if (upsert.error) {
      if (isMissingRelationError(upsert.error.message, "admin_anomaly_dismissals")) {
        return NextResponse.json(
          {
            error: "admin_anomaly_dismissals table missing or inaccessible",
            details: upsert.error.message,
            hint: "Apply migration db/migrations/20260415_admin_anomaly_dismissals.sql",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to save anomaly dismissal", details: upsert.error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      competition_id: gate.competitionId,
      season,
      dismiss_key: dismissKey,
      expires_at_utc: expiresAtUtc,
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
