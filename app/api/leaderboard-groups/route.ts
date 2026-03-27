import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  getAuthedUser,
  getCompetitionMemberDirectory,
  isMissingLeaderboardGroupsTableError,
  resolveCompetitionIdForSeason,
  userIsCompetitionMember,
} from "@/lib/leaderboard-groups";

type InviteRow = {
  id: string;
  group_id: string;
  invited_by_user_id: string;
  created_at: string;
};

type GroupRow = {
  id: string;
  name: string;
  season: number;
  competition_id: string;
  created_by_user_id: string;
  created_at: string;
};

type GroupMembershipRow = {
  group_id: string;
  user_id: string;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

type GroupCreatePayload = {
  season?: unknown;
  name?: unknown;
  invite_user_ids?: unknown;
};

const GROUP_SETUP_HINT = "Apply migration db/migrations/20260327_leaderboard_groups.sql";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeDisplayName(name: string | null | undefined, userId: string) {
  const n = String(name ?? "").trim();
  if (n) return n;
  return `${userId.slice(0, 8)}...`;
}

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
    if (UUID_RE.test(userId)) {
      deduped.add(userId);
    }
  });
  return Array.from(deduped);
}

export async function GET(req: Request) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    if (!Number.isFinite(season)) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const competitionId = await resolveCompetitionIdForSeason({
      season,
      userId: user.id,
      supabase,
    });

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const isMember = await userIsCompetitionMember({
      competitionId,
      userId: user.id,
      supabase,
    });
    if (!isMember) {
      return NextResponse.json({ error: "Competition member only" }, { status: 403 });
    }

    const [memberDirectory, inviteResult, myMembershipResult] = await Promise.all([
      getCompetitionMemberDirectory({ competitionId, supabase }),
      supabase
        .from("leaderboard_group_invites")
        .select("id, group_id, invited_by_user_id, created_at")
        .eq("invited_user_id", user.id)
        .eq("competition_id", competitionId)
        .eq("season", season)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("leaderboard_group_members")
        .select("group_id")
        .eq("user_id", user.id),
    ]);

    if (inviteResult.error) {
      const errCode = "code" in inviteResult.error ? String(inviteResult.error.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(inviteResult.error.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to load pending invites", details: inviteResult.error.message },
        { status: 500 }
      );
    }

    if (myMembershipResult.error) {
      const errCode = "code" in myMembershipResult.error ? String(myMembershipResult.error.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(myMembershipResult.error.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to load your group memberships", details: myMembershipResult.error.message },
        { status: 500 }
      );
    }

    const inviteRows = (inviteResult.data ?? []) as InviteRow[];
    const myGroupIds = Array.from(
      new Set((myMembershipResult.data ?? []).map((row) => String((row as { group_id: string }).group_id)))
    );
    const inviteGroupIds = Array.from(new Set(inviteRows.map((row) => String(row.group_id))));
    const combinedGroupIds = Array.from(new Set([...myGroupIds, ...inviteGroupIds]));

    let groups: GroupRow[] = [];
    let groupMembers: GroupMembershipRow[] = [];

    if (combinedGroupIds.length > 0) {
      const [groupResult, memberResult] = await Promise.all([
        supabase
          .from("leaderboard_groups")
          .select("id, name, season, competition_id, created_by_user_id, created_at")
          .eq("competition_id", competitionId)
          .eq("season", season)
          .in("id", combinedGroupIds),
        supabase
          .from("leaderboard_group_members")
          .select("group_id, user_id")
          .in("group_id", combinedGroupIds),
      ]);

      if (groupResult.error) {
        const errCode = "code" in groupResult.error ? String(groupResult.error.code ?? "") : "";
        if (isMissingLeaderboardGroupsTableError(groupResult.error.message, errCode)) {
          return setupRequiredResponse();
        }
        return NextResponse.json(
          { error: "Failed to load groups", details: groupResult.error.message },
          { status: 500 }
        );
      }

      if (memberResult.error) {
        const errCode = "code" in memberResult.error ? String(memberResult.error.code ?? "") : "";
        if (isMissingLeaderboardGroupsTableError(memberResult.error.message, errCode)) {
          return setupRequiredResponse();
        }
        return NextResponse.json(
          { error: "Failed to load group members", details: memberResult.error.message },
          { status: 500 }
        );
      }

      groups = (groupResult.data ?? []) as GroupRow[];
      groupMembers = (memberResult.data ?? []) as GroupMembershipRow[];
    }

    const profileUserIds = Array.from(
      new Set(
        [
          ...groups.map((group) => String(group.created_by_user_id)),
          ...inviteRows.map((invite) => String(invite.invited_by_user_id)),
        ].filter((id) => id.length > 0)
      )
    );

    let profiles: ProfileRow[] = [];
    if (profileUserIds.length > 0) {
      const { data: profileRows, error: profileErr } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", profileUserIds);

      if (profileErr) {
        return NextResponse.json(
          { error: "Failed to load profile names", details: profileErr.message },
          { status: 500 }
        );
      }
      profiles = (profileRows ?? []) as ProfileRow[];
    }

    const profileNameById = new Map<string, string>();
    profiles.forEach((profile) => {
      profileNameById.set(
        String(profile.id),
        safeDisplayName(profile.display_name, String(profile.id))
      );
    });

    const groupById = new Map<string, GroupRow>();
    groups.forEach((group) => {
      groupById.set(String(group.id), group);
    });

    const memberIdsByGroup = new Map<string, string[]>();
    groupMembers.forEach((row) => {
      const groupId = String(row.group_id);
      if (!memberIdsByGroup.has(groupId)) {
        memberIdsByGroup.set(groupId, []);
      }
      memberIdsByGroup.get(groupId)!.push(String(row.user_id));
    });

    const myGroups = groups
      .filter((group) => myGroupIds.includes(String(group.id)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" }))
      .map((group) => {
        const groupId = String(group.id);
        const memberIds = Array.from(new Set(memberIdsByGroup.get(groupId) ?? []));
        return {
          id: groupId,
          name: String(group.name),
          season: Number(group.season),
          created_at: String(group.created_at),
          created_by_user_id: String(group.created_by_user_id),
          created_by_display_name:
            profileNameById.get(String(group.created_by_user_id)) ??
            safeDisplayName(null, String(group.created_by_user_id)),
          member_count: memberIds.length,
          member_user_ids: memberIds,
          is_creator: String(group.created_by_user_id) === user.id,
        };
      });

    const pendingInvites = inviteRows.map((invite) => {
      const group = groupById.get(String(invite.group_id));
      const invitedByUserId = String(invite.invited_by_user_id);
      const groupName = String(group?.name ?? "Private group");
      return {
        id: String(invite.id),
        group_id: String(invite.group_id),
        group_name: groupName,
        invited_by_user_id: invitedByUserId,
        invited_by_display_name:
          profileNameById.get(invitedByUserId) ?? safeDisplayName(null, invitedByUserId),
        created_at: String(invite.created_at),
      };
    });

    return NextResponse.json({
      ok: true,
      season,
      competition_id: competitionId,
      pending_invites_count: pendingInvites.length,
      pending_invites: pendingInvites,
      groups: myGroups,
      member_directory: memberDirectory,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load leaderboard groups", details },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as GroupCreatePayload | null;
    const season = Number(body?.season ?? NaN);
    const name = String(body?.name ?? "").trim().slice(0, 80);
    const inviteUserIds = normalizeInviteUserIds(body?.invite_user_ids);

    if (!Number.isFinite(season)) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }
    if (name.length < 2) {
      return NextResponse.json({ error: "Group name must be at least 2 characters" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const competitionId = await resolveCompetitionIdForSeason({
      season,
      userId: user.id,
      supabase,
    });

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const isMember = await userIsCompetitionMember({
      competitionId,
      userId: user.id,
      supabase,
    });
    if (!isMember) {
      return NextResponse.json({ error: "Competition member only" }, { status: 403 });
    }

    const now = new Date().toISOString();
    const { data: insertedGroup, error: groupErr } = await supabase
      .from("leaderboard_groups")
      .insert({
        competition_id: competitionId,
        season,
        name,
        created_by_user_id: user.id,
        created_at: now,
        updated_at: now,
      })
      .select("id, name, season, competition_id, created_by_user_id, created_at")
      .single();

    if (groupErr || !insertedGroup) {
      const errCode = groupErr && "code" in groupErr ? String(groupErr.code ?? "") : "";
      if (groupErr && isMissingLeaderboardGroupsTableError(groupErr.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to create group", details: groupErr?.message ?? "Unknown error" },
        { status: 500 }
      );
    }

    const groupId = String(insertedGroup.id);
    const { error: ownerMemberErr } = await supabase
      .from("leaderboard_group_members")
      .upsert(
        {
          group_id: groupId,
          user_id: user.id,
          added_by_user_id: user.id,
          joined_at: now,
        },
        { onConflict: "group_id,user_id" }
      );

    if (ownerMemberErr) {
      const errCode = "code" in ownerMemberErr ? String(ownerMemberErr.code ?? "") : "";
      if (isMissingLeaderboardGroupsTableError(ownerMemberErr.message, errCode)) {
        return setupRequiredResponse();
      }
      return NextResponse.json(
        { error: "Failed to add group owner", details: ownerMemberErr.message },
        { status: 500 }
      );
    }

    let invitesCreated = 0;
    if (inviteUserIds.length > 0) {
      const memberDirectory = await getCompetitionMemberDirectory({ competitionId, supabase });
      const validUserIds = new Set(memberDirectory.map((member) => member.user_id));
      const cleanInviteUserIds = inviteUserIds.filter(
        (inviteUserId) => inviteUserId !== user.id && validUserIds.has(inviteUserId)
      );

      if (cleanInviteUserIds.length > 0) {
        const inviteRows = cleanInviteUserIds.map((inviteUserId) => ({
          group_id: groupId,
          competition_id: competitionId,
          season,
          invited_user_id: inviteUserId,
          invited_by_user_id: user.id,
          status: "pending",
          created_at: now,
          updated_at: now,
        }));

        const { error: inviteErr } = await supabase
          .from("leaderboard_group_invites")
          .insert(inviteRows);

        if (inviteErr) {
          const errCode = "code" in inviteErr ? String(inviteErr.code ?? "") : "";
          if (isMissingLeaderboardGroupsTableError(inviteErr.message, errCode)) {
            return setupRequiredResponse();
          }
          return NextResponse.json(
            { error: "Group created but invites failed", details: inviteErr.message },
            { status: 500 }
          );
        }
        invitesCreated = inviteRows.length;
      }
    }

    return NextResponse.json({
      ok: true,
      group: {
        id: groupId,
        name: String(insertedGroup.name ?? ""),
        season: Number(insertedGroup.season),
        competition_id: String(insertedGroup.competition_id),
        created_by_user_id: String(insertedGroup.created_by_user_id),
        created_at: String(insertedGroup.created_at),
      },
      invites_created: invitesCreated,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create leaderboard group", details },
      { status: 500 }
    );
  }
}
