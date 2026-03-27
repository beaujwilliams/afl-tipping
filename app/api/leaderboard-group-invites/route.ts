import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  getAuthedUser,
  isMissingLeaderboardGroupsTableError,
} from "@/lib/leaderboard-groups";

const GROUP_SETUP_HINT = "Apply migration db/migrations/20260327_leaderboard_groups.sql";

export async function GET(req: Request) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const seasonParam = url.searchParams.get("season");
    const season = seasonParam === null ? null : Number(seasonParam);
    if (seasonParam !== null && !Number.isFinite(season)) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    let query = createServiceClient()
      .from("leaderboard_group_invites")
      .select("id", { count: "exact", head: true })
      .eq("invited_user_id", user.id)
      .eq("status", "pending");

    if (Number.isFinite(season)) {
      query = query.eq("season", Number(season));
    }

    const { count, error } = await query;
    if (error) {
      const errCode = "code" in error ? String(error.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(error.message, errCode)) {
        return NextResponse.json({
          ok: true,
          pending_count: 0,
          setup_required: true,
          hint: GROUP_SETUP_HINT,
        });
      }
      return NextResponse.json(
        { error: "Failed to read pending invites", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, pending_count: Number(count ?? 0) });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to read pending invites", details },
      { status: 500 }
    );
  }
}
