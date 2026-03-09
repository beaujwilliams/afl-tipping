import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getDefaultCompetitionId, requireAdminOrCron } from "@/lib/admin-auth";

type RoundRecapRow = {
  id: number;
  season: number;
  round_number: number;
  recap_type: string;
  subject: string;
  narrative_text: string;
  raw_stats_text: string;
  generated_at: string;
  updated_at: string;
  summary_json: unknown;
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
    const roundParam = url.searchParams.get("round");
    const limitParam = url.searchParams.get("limit");

    const season = seasonParam === null ? null : Number(seasonParam);
    const round = roundParam === null ? null : Number(roundParam);
    const parsedLimit = Number(limitParam ?? "40");
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(200, Math.floor(parsedLimit)))
      : 40;

    if (season !== null && (!Number.isFinite(season) || season < 2000 || season > 2100)) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    if (round !== null && (!Number.isFinite(round) || round < 0 || round > 40)) {
      return NextResponse.json({ error: "Provide a valid round" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await getDefaultCompetitionId(supabase);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    let query = supabase
      .from("round_recaps")
      .select(
        "id, season, round_number, recap_type, subject, narrative_text, raw_stats_text, generated_at, updated_at, summary_json"
      )
      .eq("competition_id", competitionId)
      .order("season", { ascending: false })
      .order("round_number", { ascending: false })
      .limit(limit);

    if (season !== null) query = query.eq("season", season);
    if (round !== null) query = query.eq("round_number", round);

    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error.message, "round_recaps")) {
        return NextResponse.json(
          {
            error: "round_recaps table missing or inaccessible",
            details: error.message,
            hint: "Apply migration db/migrations/20260310_round_recaps.sql",
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { error: "Failed to load round recaps", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      competition_id: competitionId,
      recaps: (data ?? []) as RoundRecapRow[],
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "Unexpected error", details }, { status: 500 });
  }
}
