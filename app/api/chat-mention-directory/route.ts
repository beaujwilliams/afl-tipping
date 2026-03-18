import { NextResponse } from "next/server";
import { getBearer, getUserIdFromBearer } from "@/lib/admin-auth";
import { createServiceClient } from "@/lib/supabase-server";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";

type MembershipRow = {
  user_id: string;
};

type SelfMembershipRow = {
  user_id: string;
};

type UserCompetitionRow = {
  competition_id: string;
};

type RoundCompetitionRow = {
  competition_id: string;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  username?: string | null;
};

function isMissingColumnError(message: string, columnName: string) {
  const m = String(message ?? "").toLowerCase();
  const c = String(columnName ?? "").toLowerCase();
  return m.includes(c) && (m.includes("column") || m.includes("does not exist"));
}

export async function GET(req: Request) {
  try {
    const token = getBearer(req);
    if (!token) {
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }

    const userId = await getUserIdFromBearer(req);
    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const explicitCompetitionId = url.searchParams.get("competition_id")?.trim() ?? null;

    const supabase = createServiceClient();
    let competitionIds: string[] = [];

    if (explicitCompetitionId) {
      const { data: selfMembership, error: selfMembershipErr } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("competition_id", explicitCompetitionId)
        .eq("user_id", userId)
        .maybeSingle();

      if (selfMembershipErr) {
        return NextResponse.json(
          { error: "Failed to validate membership", details: selfMembershipErr.message },
          { status: 500 }
        );
      }

      if (!(selfMembership as SelfMembershipRow | null)?.user_id) {
        return NextResponse.json({ error: "Not a member of this competition" }, { status: 403 });
      }

      competitionIds = [explicitCompetitionId];
    } else {
      const { data: myCompetitions, error: myCompetitionsErr } = await supabase
        .from("memberships")
        .select("competition_id")
        .eq("user_id", userId);

      if (myCompetitionsErr) {
        return NextResponse.json(
          { error: "Failed to read your competitions", details: myCompetitionsErr.message },
          { status: 500 }
        );
      }

      const memberCompetitionIds = Array.from(
        new Set(
          ((myCompetitions ?? []) as UserCompetitionRow[])
            .map((row) => String(row.competition_id ?? "").trim())
            .filter((id) => id.length > 0)
        )
      );

      if (!memberCompetitionIds.length) {
        return NextResponse.json({ error: "No competition memberships found" }, { status: 404 });
      }

      const { data: seasonRoundCompetitions, error: seasonRoundErr } = await supabase
        .from("rounds")
        .select("competition_id")
        .eq("season", season)
        .in("competition_id", memberCompetitionIds);

      if (seasonRoundErr) {
        return NextResponse.json(
          { error: "Failed to resolve season competitions", details: seasonRoundErr.message },
          { status: 500 }
        );
      }

      const seasonCompetitionIds = Array.from(
        new Set(
          ((seasonRoundCompetitions ?? []) as RoundCompetitionRow[])
            .map((row) => String(row.competition_id ?? "").trim())
            .filter((id) => id.length > 0)
        )
      );

      if (seasonCompetitionIds.length) {
        competitionIds = seasonCompetitionIds;
      } else {
        const fallbackCompetitionId = await resolveCompetitionIdForSeason({
          season,
          userId,
          supabase,
        });
        competitionIds = fallbackCompetitionId
          ? Array.from(new Set([fallbackCompetitionId, ...memberCompetitionIds]))
          : memberCompetitionIds;
      }
    }

    const { data: memberships, error: membershipsErr } = await supabase
      .from("memberships")
      .select("user_id")
      .in("competition_id", competitionIds);

    if (membershipsErr) {
      return NextResponse.json(
        { error: "Failed to read memberships", details: membershipsErr.message },
        { status: 500 }
      );
    }

    const memberIds = Array.from(
      new Set(((memberships ?? []) as MembershipRow[]).map((m) => String(m.user_id)))
    );

    if (!memberIds.length) {
      return NextResponse.json({
        ok: true,
        competition_ids: competitionIds,
        members: [],
      });
    }

    let profiles: ProfileRow[] = [];

    const withUsername = await supabase
      .from("profiles")
      .select("id, display_name, username")
      .in("id", memberIds);

    if (withUsername.error) {
      if (!isMissingColumnError(withUsername.error.message, "username")) {
        return NextResponse.json(
          { error: "Failed to read profiles", details: withUsername.error.message },
          { status: 500 }
        );
      }

      const fallback = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", memberIds);

      if (fallback.error) {
        return NextResponse.json(
          { error: "Failed to read profiles", details: fallback.error.message },
          { status: 500 }
        );
      }

      profiles = ((fallback.data ?? []) as ProfileRow[]).map((p) => ({
        ...p,
        username: null,
      }));
    } else {
      profiles = (withUsername.data ?? []) as ProfileRow[];
    }

    const byId = new Map<string, ProfileRow>();
    profiles.forEach((p) => {
      byId.set(String(p.id), p);
    });

    const members = memberIds
      .map((uid) => {
        const p = byId.get(uid);
        const displayName = String(p?.display_name ?? "").trim() || null;
        const username = String(p?.username ?? "")
          .trim()
          .toLowerCase() || null;
        return {
          user_id: uid,
          display_name: displayName,
          username,
        };
      })
      .sort((a, b) => {
        const aName = a.display_name ?? a.username ?? a.user_id;
        const bName = b.display_name ?? b.username ?? b.user_id;
        return aName.localeCompare(bName, "en", { sensitivity: "base" });
      });

    return NextResponse.json({
      ok: true,
      competition_ids: competitionIds,
      members,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to build mention directory", details },
      { status: 500 }
    );
  }
}
