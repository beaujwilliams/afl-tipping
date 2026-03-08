import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { resolveReigningChampion } from "@/lib/reigning-champion";

const DEFAULT_SEASON = 2026;

export async function GET(req: Request) {
  try {
    const supabase = createServiceClient();
    const url = new URL(req.url);

    const season = Number(url.searchParams.get("season") || String(DEFAULT_SEASON));

    const competitionFromQS = url.searchParams.get("competition_id")?.trim();
    let competitionId = competitionFromQS || null;

    if (!competitionId) {
      const { data: comp, error } = await supabase
        .from("competitions")
        .select("id")
        .limit(1)
        .single();

      if (error || !comp?.id) {
        return NextResponse.json({ error: "No competition found" }, { status: 404 });
      }

      competitionId = String(comp.id);
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
