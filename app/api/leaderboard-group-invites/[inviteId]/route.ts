import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  getAuthedUser,
  isMissingLeaderboardGroupsTableError,
} from "@/lib/leaderboard-groups";

type InviteAction = "accept" | "decline";

type InvitePayload = {
  action?: unknown;
};

type InviteRow = {
  id: string;
  group_id: string;
  invited_user_id: string;
  invited_by_user_id: string;
  status: string;
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

function normalizeAction(value: unknown): InviteAction | null {
  const action = String(value ?? "")
    .trim()
    .toLowerCase();
  if (action === "accept" || action === "decline") return action;
  return null;
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ inviteId: string }> }
) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const params = await context.params;
    const inviteId = String(params.inviteId ?? "").trim();
    if (!inviteId) {
      return NextResponse.json({ error: "Invite id is required" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as InvitePayload | null;
    const action = normalizeAction(body?.action);
    if (!action) {
      return NextResponse.json(
        { error: "Action must be either accept or decline" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const { data: invite, error: inviteErr } = await supabase
      .from("leaderboard_group_invites")
      .select("id, group_id, invited_user_id, invited_by_user_id, status")
      .eq("id", inviteId)
      .maybeSingle();

    if (inviteErr) {
      const errCode = "code" in inviteErr ? String(inviteErr.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(inviteErr.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to load invite", details: inviteErr.message },
        { status: 500 }
      );
    }

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    const inviteRow = invite as InviteRow;
    if (String(inviteRow.invited_user_id) !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (String(inviteRow.status) !== "pending") {
      return NextResponse.json({ error: "Invite has already been handled" }, { status: 409 });
    }

    const now = new Date().toISOString();
    if (action === "accept") {
      const { error: memberErr } = await supabase
        .from("leaderboard_group_members")
        .upsert(
          {
            group_id: String(inviteRow.group_id),
            user_id: user.id,
            added_by_user_id: String(inviteRow.invited_by_user_id),
            joined_at: now,
          },
          { onConflict: "group_id,user_id" }
        );

      if (memberErr) {
        const errCode = "code" in memberErr ? String(memberErr.code ?? "") : "";
        if (isMissingLeaderboardGroupsTableError(memberErr.message, errCode)) {
          return setupRequiredResponse();
        }
        return NextResponse.json(
          { error: "Failed to join group", details: memberErr.message },
          { status: 500 }
        );
      }
    }

    const nextStatus = action === "accept" ? "accepted" : "declined";
    const { error: updateErr } = await supabase
      .from("leaderboard_group_invites")
      .update({
        status: nextStatus,
        handled_at: now,
        updated_at: now,
      })
      .eq("id", inviteId)
      .eq("status", "pending");

    if (updateErr) {
      const errCode = "code" in updateErr ? String(updateErr.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(updateErr.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to update invite", details: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, invite_id: inviteId, status: nextStatus });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to handle invite", details },
      { status: 500 }
    );
  }
}
