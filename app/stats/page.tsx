import { redirect } from "next/navigation";
import StatsPageClient from "@/components/StatsPageClient";
import { createClient } from "@/lib/supabase-server";
import { getStatsPagePayload } from "@/lib/stats-data";
import type { StatsInsights, StatsSnapshot, TeamStatsRow, TeamStatsTotals } from "@/lib/stats-types";

const CURRENT_SEASON = 2026;

export default async function StatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let snapshot: StatsSnapshot | null = null;
  let insights: StatsInsights | null = null;
  let teamRows: TeamStatsRow[] = [];
  let teamTotals: TeamStatsTotals | null = null;
  let statsMsg: string | null = null;
  let teamStatsMsg: string | null = null;

  try {
    const payload = await getStatsPagePayload({
      season: CURRENT_SEASON,
      userId: user.id,
    });

    snapshot = payload.snapshot;
    insights = payload.insights;
    teamRows = payload.team_rows;
    teamTotals = payload.team_rows.length ? payload.team_totals : null;
    statsMsg = payload.snapshot ? null : "No season stats yet.";
    teamStatsMsg = payload.team_rows.length ? null : "No team stats yet.";
  } catch {
    statsMsg = "Could not load season stats.";
    teamStatsMsg = "Could not load team breakdown.";
  }

  return (
    <StatsPageClient
      season={CURRENT_SEASON}
      snapshot={snapshot}
      insights={insights}
      teamRows={teamRows}
      teamTotals={teamTotals}
      statsMsg={statsMsg}
      teamStatsMsg={teamStatsMsg}
    />
  );
}
