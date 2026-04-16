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
    `/api/admin/send-prelock-reminders?season=${season}&hours_before_lock=4&window_minutes=15&window_direction=before`,
    { season, jobKind: "prelock_reminders" }
  );
}
