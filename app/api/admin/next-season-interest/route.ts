import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import { NEXT_SEASON } from "@/lib/season-config";

type InterestStatus = "pending" | "notified" | "unsubscribed";

type InterestRow = {
  id: string;
  target_season: number;
  email: string;
  full_name: string | null;
  status: InterestStatus;
  source: string;
  notes: string | null;
  submitted_at_utc: string;
  created_at: string;
  updated_at: string;
};

function parseSeason(raw: string | null, fallback: number) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return fallback;
  return Math.trunc(parsed);
}

function parseLimit(raw: string | null, fallback: number) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(1000, Math.trunc(parsed));
}

function normalizeStatus(raw: unknown): InterestStatus | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "pending" || value === "notified" || value === "unsubscribed") {
    return value;
  }
  return null;
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

async function assertAdmin(req: Request) {
  const supabase = createServiceClient();
  const competitionId = await resolveCompetitionIdForAdminRequest(req, supabase);
  if (!competitionId) {
    return { ok: false as const, res: NextResponse.json({ error: "No competition found" }, { status: 404 }) };
  }

  const admin = await requireAdminOrCron(req, { competitionId });
  if (!admin.ok) {
    return { ok: false as const, res: NextResponse.json(admin.json, { status: admin.status }) };
  }

  return { ok: true as const, supabase };
}

export async function GET(req: Request) {
  try {
    const adminCheck = await assertAdmin(req);
    if (!adminCheck.ok) return adminCheck.res;
    const supabase = adminCheck.supabase;

    const url = new URL(req.url);
    const season = parseSeason(url.searchParams.get("season"), NEXT_SEASON);
    const statusFilter = normalizeStatus(url.searchParams.get("status"));
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const limit = parseLimit(url.searchParams.get("limit"), 400);

    let query = supabase
      .from("next_season_interest")
      .select("id,target_season,email,full_name,status,source,notes,submitted_at_utc,created_at,updated_at")
      .eq("target_season", season)
      .order("submitted_at_utc", { ascending: false })
      .limit(limit);

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error.message, "next_season_interest")) {
        return NextResponse.json(
          {
            ok: false,
            error: "Database is missing next_season_interest table",
            details: "Run db/migrations/20260326_next_season_interest.sql and redeploy.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { ok: false, error: "Failed to read interest list", details: error.message },
        { status: 500 }
      );
    }

    const rows = ((data ?? []) as InterestRow[]).filter((row) => {
      if (!q) return true;
      const email = String(row.email ?? "").toLowerCase();
      const fullName = String(row.full_name ?? "").toLowerCase();
      const notes = String(row.notes ?? "").toLowerCase();
      const source = String(row.source ?? "").toLowerCase();
      return (
        email.includes(q) ||
        fullName.includes(q) ||
        notes.includes(q) ||
        source.includes(q)
      );
    });

    return NextResponse.json({ ok: true, season, rows });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "Unexpected error", details }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const adminCheck = await assertAdmin(req);
    if (!adminCheck.ok) return adminCheck.res;
    const supabase = adminCheck.supabase;

    const body = (await req.json().catch(() => null)) as
      | null
      | {
          id?: string;
          status?: InterestStatus;
          notes?: string | null;
        };

    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    const status = normalizeStatus(body?.status);
    if (!status) {
      return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
    }

    let notes: string | null = null;
    if (typeof body?.notes === "string") {
      const trimmed = body.notes.trim();
      notes = trimmed ? trimmed.slice(0, 2000) : null;
    }

    const { data, error } = await supabase
      .from("next_season_interest")
      .update({
        status,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id,target_season,email,full_name,status,source,notes,submitted_at_utc,created_at,updated_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "Failed to update interest row", details: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "Interest row not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, row: data });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "Unexpected error", details }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const adminCheck = await assertAdmin(req);
    if (!adminCheck.ok) return adminCheck.res;
    const supabase = adminCheck.supabase;

    const body = (await req.json().catch(() => null)) as
      | null
      | {
          id?: string;
        };

    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("next_season_interest")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "Failed to delete interest row", details: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "Interest row not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id: String(data.id) });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "Unexpected error", details }, { status: 500 });
  }
}
