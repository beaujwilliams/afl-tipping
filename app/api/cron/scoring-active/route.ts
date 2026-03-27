import { NextResponse } from "next/server";
import { forwardCronToAdmin, parseSeason } from "../_shared";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const season = parseSeason(req);
  if (season == null) {
    return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
  }

  return forwardCronToAdmin(
    req,
    `/api/admin/run-scoring-automation?season=${season}&scope=active&job_kind=scoring_15m`
  );
}
