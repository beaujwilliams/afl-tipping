import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  getAuthedUser,
  getCompetitionMemberDirectory,
  isMissingLeaderboardGroupsTableError,
  userIsCompetitionMember,
} from "@/lib/leaderboard-groups";

type GroupRow = {
  id: string;
  competition_id: string;
  season: number;
};

type GroupMembershipRow = {
  user_id: string;
};

type GroupInviteRow = {
  invited_user_id: string;
};

type InvitePayload = {
  invite_user_ids?: unknown;
};

const GROUP_SETUP_HINT = "Apply migration db/migrations/20260327_leaderboard_groups.sql";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setupRequiredResponse() {
  return NextResponse.json(
    {
      error: "Private leaderboard groups are not set up yet.",
      hint: GROUP_SETUP_HINT,
    },
    { status: 500 }
  );
}

function normalizeInviteUserIds(input: unknown) {
  if (!Array.isArray(input)) return [];
  const deduped = new Set<string>();
  input.forEach((value) => {
    const userId = String(value ?? "").trim();
    if (UUID_RE.test(userId)) deduped.add(userId);
  });
  return Array.from(deduped);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ groupId: string }> }
) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const params = await context.params;
    const groupId = String(params.groupId ?? "").trim();
    if (!groupId) {
      return NextResponse.json({ error: "Group id is required" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as InvitePayload | null;
    const requestedInviteIds = normalizeInviteUserIds(body?.invite_user_ids);
    if (requestedInviteIds.length === 0) {
      return NextResponse.json(
        { error: "Select at least one valid member to invite" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data: group, error: groupErr } = await supabase
      .from("leaderboard_groups")
      .select("id, competition_id, season")
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

    const [isCompMember, myGroupMembership] = await Promise.all([
      userIsCompetitionMember({
        competitionId,
        userId: user.id,
        supabase,
      }),
      supabase
        .from("leaderboard_group_members")
        .select("user_id")
        .eq("group_id", groupId)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    if (!isCompMember) {
      return NextResponse.json({ error: "Competition member only" }, { status: 403 });
    }

    if (myGroupMembership.error) {
      const errCode =
        "code" in myGroupMembership.error ? String(myGroupMembership.error.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(myGroupMembership.error.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to verify group access", details: myGroupMembership.error.message },
        { status: 500 }
      );
    }

    if (!myGroupMembership.data?.user_id) {
      return NextResponse.json({ error: "Only group members can invite others" }, { status: 403 });
    }

    const [memberDirectory, existingMembersResult, existingInvitesResult] = await Promise.all([
      getCompetitionMemberDirectory({ competitionId, supabase }),
      supabase.from("leaderboard_group_members").select("user_id").eq("group_id", groupId),
      supabase
        .from("leaderboard_group_invites")
        .select("invited_user_id")
        .eq("group_id", groupId)
        .eq("status", "pending"),
    ]);

    if (existingMembersResult.error) {
      const errCode =
        "code" in existingMembersResult.error ? String(existingMembersResult.error.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(existingMembersResult.error.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to read existing members", details: existingMembersResult.error.message },
        { status: 500 }
      );
    }

    if (existingInvitesResult.error) {
      const errCode =
        "code" in existingInvitesResult.error ? String(existingInvitesResult.error.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(existingInvitesResult.error.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to read existing invites", details: existingInvitesResult.error.message },
        { status: 500 }
      );
    }

    const validCompUserIds = new Set(memberDirectory.map((row) => row.user_id));
    const existingMemberIds = new Set(
      ((existingMembersResult.data ?? []) as GroupMembershipRow[]).map((row) =>
        String(row.user_id)
      )
    );
    const existingPendingInviteIds = new Set(
      ((existingInvitesResult.data ?? []) as GroupInviteRow[]).map((row) =>
        String(row.invited_user_id)
      )
    );

    const inviteUserIds = requestedInviteIds.filter((inviteUserId) => {
      if (inviteUserId === user.id) return false;
      if (!validCompUserIds.has(inviteUserId)) return false;
      if (existingMemberIds.has(inviteUserId)) return false;
      if (existingPendingInviteIds.has(inviteUserId)) return false;
      return true;
    });

    if (inviteUserIds.length === 0) {
      return NextResponse.json({
        ok: true,
        invited_count: 0,
        skipped_count: requestedInviteIds.length,
      });
    }

    const now = new Date().toISOString();
    const inviteRows = inviteUserIds.map((inviteUserId) => ({
      group_id: groupId,
      competition_id: competitionId,
      season: Number(groupRow.season),
      invited_user_id: inviteUserId,
      invited_by_user_id: user.id,
      status: "pending",
      created_at: now,
      updated_at: now,
    }));

    const { error: insertErr } = await supabase
      .from("leaderboard_group_invites")
      .insert(inviteRows);

    if (insertErr) {
      const errCode = "code" in insertErr ? String(insertErr.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(insertErr.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to create invites", details: insertErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      invited_count: inviteRows.length,
      skipped_count: requestedInviteIds.length - inviteRows.length,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to invite members", details },
      { status: 500 }
    );
  }
}
