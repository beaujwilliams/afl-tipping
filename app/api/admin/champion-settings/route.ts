import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import { resolveReigningChampion } from "@/lib/reigning-champion";

const DEFAULT_SEASON = 2026;

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

    const gate = await requireAdminOrCron(req, { competitionId });
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || String(DEFAULT_SEASON));

    const resolved = await resolveReigningChampion({
      competitionId,
      season,
      supabase,
    });

    return NextResponse.json({
      ok: true,
      competition_id: competitionId,
      season,
      ...resolved,
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
    const supabase = createServiceClient();
    const competitionId = await getCompetitionId(supabase, req);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const gate = await requireAdminOrCron(req, { competitionId });
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || String(DEFAULT_SEASON));

    const body = (await req.json().catch(() => null)) as
      | null
      | { reigning_champion_override_user_id?: string | null };

    if (!body || !("reigning_champion_override_user_id" in body)) {
      return NextResponse.json(
        { error: "Missing reigning_champion_override_user_id in body" },
        { status: 400 }
      );
    }

    const overrideUserIdRaw = body.reigning_champion_override_user_id;
    const overrideUserId =
      typeof overrideUserIdRaw === "string" && overrideUserIdRaw.trim().length
        ? overrideUserIdRaw.trim()
        : null;

    const checkColumn = await supabase
      .from("competitions")
      .select("reigning_champion_override_user_id")
      .eq("id", competitionId)
      .single();

    if (
      checkColumn.error &&
      isMissingColumnError(checkColumn.error.message, "reigning_champion_override_user_id")
    ) {
      return NextResponse.json(
        {
          error: "Database is missing competitions.reigning_champion_override_user_id",
          hint: "Apply migration db/migrations/20260309_reigning_champion_hybrid.sql",
        },
        { status: 500 }
      );
    }

    if (checkColumn.error) {
      return NextResponse.json(
        { error: "Failed to read competition", details: checkColumn.error.message },
        { status: 500 }
      );
    }

    if (overrideUserId) {
      const { data: memberRow, error: memErr } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("competition_id", competitionId)
        .eq("user_id", overrideUserId)
        .maybeSingle();

      if (memErr) {
        return NextResponse.json(
          { error: "Failed to validate member", details: memErr.message },
          { status: 500 }
        );
      }

      if (!memberRow) {
        return NextResponse.json(
          { error: "Champion override must be an existing competition member" },
          { status: 400 }
        );
      }
    }

    const { error: updateErr } = await supabase
      .from("competitions")
      .update({ reigning_champion_override_user_id: overrideUserId })
      .eq("id", competitionId);

    if (updateErr) {
      return NextResponse.json(
        { error: "Failed to save champion override", details: updateErr.message },
        { status: 500 }
      );
    }

    const resolved = await resolveReigningChampion({
      competitionId,
      season,
      supabase,
    });

    return NextResponse.json({
      ok: true,
      competition_id: competitionId,
      season,
      ...resolved,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Unexpected error", details },
      { status: 500 }
    );
  }
}
