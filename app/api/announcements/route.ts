import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase-server";
import { getBearer } from "@/lib/admin-auth";

type MembershipRow = {
  competition_id: string;
  role: string | null;
};

type AnnouncementRow = {
  id: string;
  competition_id: string | null;
  title: string;
  body: string;
  image_urls: string[] | null;
  is_pinned: boolean | null;
  published_at_utc: string | null;
  created_at: string | null;
  created_by_user_id: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

function isMissingSchemaCacheTableError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return (
    m.includes("schema cache") &&
    (m.includes(rel) || m.includes(`public.${rel}`)) &&
    m.includes("could not find the table")
  );
}

function isMissingAnnouncementsTableError(message: string, code?: string) {
  const normalizedCode = String(code ?? "").toUpperCase();
  return (
    isMissingRelationError(message, "announcements") ||
    isMissingSchemaCacheTableError(message, "announcements") ||
    normalizedCode === "PGRST205"
  );
}

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

async function getUserFromBearer(req: Request) {
  const token = getBearer(req);
  if (!token) return null;

  const authClient = createSupabaseClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function getAuthedUser(req: Request) {
  const fromBearer = await getUserFromBearer(req);
  if (fromBearer) return fromBearer;

  const authClient = await createClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

function pickPreferredCompetitionId(rows: MembershipRow[]) {
  const ids = Array.from(
    new Set(rows.map((row) => String(row.competition_id)).filter((value) => value.length > 0))
  );
  if (!ids.length) return null;
  ids.sort((a, b) => a.localeCompare(b));
  return ids[0];
}

function isAdminRole(role: string | null | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toLowerCase();
  return normalized === "owner" || normalized === "admin";
}

export async function GET(req: Request) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const service = createServiceClient();
    const { data: memberships, error: membershipErr } = await service
      .from("memberships")
      .select("competition_id, role")
      .eq("user_id", user.id);

    if (membershipErr) {
      return NextResponse.json(
        { error: "Failed to read memberships", details: membershipErr.message },
        { status: 500 }
      );
    }

    const membershipRows = (memberships ?? []) as MembershipRow[];
    const competitionId = pickPreferredCompetitionId(membershipRows);
    const isAdmin = membershipRows.some(
      (row) => String(row.competition_id) === String(competitionId) && isAdminRole(row.role)
    );

    const baseSelect =
      "id, competition_id, title, body, image_urls, is_pinned, published_at_utc, created_at, created_by_user_id";

    const globalQuery = service
      .from("announcements")
      .select(baseSelect)
      .eq("is_published", true)
      .is("competition_id", null)
      .order("is_pinned", { ascending: false })
      .order("published_at_utc", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(120);

    const competitionQuery = competitionId
      ? service
          .from("announcements")
          .select(baseSelect)
          .eq("is_published", true)
          .eq("competition_id", competitionId)
          .order("is_pinned", { ascending: false })
          .order("published_at_utc", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(120)
      : null;

    const [competitionResult, globalResult] = await Promise.all([
      competitionQuery,
      globalQuery,
    ]);

    if (competitionResult?.error) {
      const errCode = "code" in competitionResult.error ? String(competitionResult.error.code ?? "") : "";
      if (isMissingAnnouncementsTableError(competitionResult.error.message, errCode)) {
        return NextResponse.json(
          {
            error: "Announcements are not set up yet.",
            hint: "Apply migration db/migrations/20260325_announcements.sql",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to read announcements", details: competitionResult.error.message },
        { status: 500 }
      );
    }

    if (globalResult.error) {
      const errCode = "code" in globalResult.error ? String(globalResult.error.code ?? "") : "";
      if (isMissingAnnouncementsTableError(globalResult.error.message, errCode)) {
        return NextResponse.json(
          {
            error: "Announcements are not set up yet.",
            hint: "Apply migration db/migrations/20260325_announcements.sql",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to read announcements", details: globalResult.error.message },
        { status: 500 }
      );
    }

    const dedupe = new Map<string, AnnouncementRow>();
    const addRows = (incoming: AnnouncementRow[]) => {
      incoming.forEach((row) => {
        const id = String(row.id);
        if (!id || dedupe.has(id)) return;
        dedupe.set(id, row);
      });
    };

    addRows(((competitionResult?.data ?? []) as AnnouncementRow[]).slice(0, 120));
    addRows(((globalResult.data ?? []) as AnnouncementRow[]).slice(0, 120));

    const rows = Array.from(dedupe.values()).sort((a, b) => {
      const aPinned = a.is_pinned ? 1 : 0;
      const bPinned = b.is_pinned ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      const aPublished = new Date(a.published_at_utc ?? a.created_at ?? "").getTime();
      const bPublished = new Date(b.published_at_utc ?? b.created_at ?? "").getTime();
      const aPublishedSafe = Number.isFinite(aPublished) ? aPublished : 0;
      const bPublishedSafe = Number.isFinite(bPublished) ? bPublished : 0;
      if (bPublishedSafe !== aPublishedSafe) return bPublishedSafe - aPublishedSafe;
      return String(b.id).localeCompare(String(a.id));
    });
    const authorIds = Array.from(
      new Set(rows.map((row) => String(row.created_by_user_id ?? "")).filter((value) => value.length > 0))
    );

    const authorNameById = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: profiles, error: profileErr } = await service
        .from("profiles")
        .select("id, display_name")
        .in("id", authorIds);

      if (!profileErr) {
        ((profiles ?? []) as ProfileRow[]).forEach((profile) => {
          authorNameById.set(String(profile.id), String(profile.display_name ?? "").trim());
        });
      }
    }

    return NextResponse.json({
      ok: true,
      competition_id: competitionId,
      admin: isAdmin,
      rows: rows.map((row) => {
        const createdByUserId = String(row.created_by_user_id ?? "");
        const fallbackName = createdByUserId ? "Admin" : null;
        const displayName = createdByUserId ? authorNameById.get(createdByUserId) ?? fallbackName : null;
        return {
          id: String(row.id),
          competition_id: row.competition_id ? String(row.competition_id) : null,
          title: String(row.title ?? ""),
          body: String(row.body ?? ""),
          image_urls: Array.isArray(row.image_urls)
            ? row.image_urls.map((url) => String(url).trim()).filter((url) => url.length > 0)
            : [],
          is_pinned: !!row.is_pinned,
          published_at_utc: row.published_at_utc,
          created_at: row.created_at,
          created_by_display_name: displayName && displayName.length > 0 ? displayName : null,
        };
      }),
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load announcements", details },
      { status: 500 }
    );
  }
}
