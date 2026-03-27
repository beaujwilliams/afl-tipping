import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  getAuthedUser,
  isMissingLeaderboardGroupsTableError,
  userIsCompetitionMember,
} from "@/lib/leaderboard-groups";

type GroupRow = {
  id: string;
  competition_id: string;
  created_by_user_id: string;
};

const GROUP_SETUP_HINT = "Apply migration db/migrations/20260327_leaderboard_groups.sql";

function setupRequiredResponse() {
  return NextResponse.json(
    {
      error: "Private leaderboard groups are not set up yet.",
      hint: GROUP_SETUP_HINT,
    },
    { status: 500 }
  );
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ groupId: string; invitedUserId: string }> }
) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const params = await context.params;
    const groupId = String(params.groupId ?? "").trim();
    const invitedUserId = String(params.invitedUserId ?? "").trim();
    if (!groupId || !invitedUserId) {
      return NextResponse.json(
        { error: "Group id and invited user id are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const { data: group, error: groupErr } = await supabase
      .from("leaderboard_groups")
      .select("id, competition_id, created_by_user_id")
      .eq("id", groupId)
      .maybeSingle();

    if (groupErr) {
      const errCode = "code" in groupErr ? String(groupErr.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(groupErr.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to load group", details: groupErr.message },
        { status: 500 }
      );
    }
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const groupRow = group as GroupRow;
    const competitionId = String(groupRow.competition_id);
    const isMember = await userIsCompetitionMember({
      competitionId,
      userId: user.id,
      supabase,
    });
    if (!isMember) {
      return NextResponse.json({ error: "Competition member only" }, { status: 403 });
    }

    if (String(groupRow.created_by_user_id) !== user.id) {
      return NextResponse.json(
        { error: "Only the group creator can rescind invites." },
        { status: 403 }
      );
    }

    const { data: deletedRows, error: deleteErr } = await supabase
      .from("leaderboard_group_invites")
      .delete()
      .eq("group_id", groupId)
      .eq("invited_user_id", invitedUserId)
      .eq("status", "pending")
      .select("id");

    if (deleteErr) {
      const errCode = "code" in deleteErr ? String(deleteErr.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(deleteErr.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to rescind invite", details: deleteErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      rescinded: Array.isArray(deletedRows) && deletedRows.length > 0,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to rescind invite", details },
      { status: 500 }
    );
  }
}
