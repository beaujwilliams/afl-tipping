import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  getUserIdFromBearer,
  resolveCompetitionIdForAdminRequest,
  userHasAdminRole,
} from "@/lib/admin-auth";

type AnnouncementInsert = {
  competition_id: string | null;
  title: string;
  body: string;
  image_urls: string[];
  is_pinned: boolean;
  is_published: boolean;
  created_by_user_id: string | null;
  published_at_utc: string;
};

type AnnouncementUpdate = {
  title: string;
  body: string;
  image_urls: string[];
  is_pinned: boolean;
  updated_at: string;
  is_published?: boolean;
};

type AnnouncementPayload = {
  title?: unknown;
  body?: unknown;
  image_urls?: unknown;
  is_pinned?: unknown;
  is_published?: unknown;
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

function normalizeImageUrls(input: unknown) {
  const values = Array.isArray(input) ? input : [];
  const deduped = new Set<string>();
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      deduped.add(value);
    } catch {
      continue;
    }
  }
  return Array.from(deduped).slice(0, 12);
}

function normalizeText(input: unknown, maxLength: number) {
  return String(input ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeAnnouncementPayload(payload: AnnouncementPayload | null) {
  const title = normalizeText(payload?.title, 140);
  const body = normalizeText(payload?.body, 12000);
  const imageUrls = normalizeImageUrls(payload?.image_urls);
  const isPinned = Boolean(payload?.is_pinned);
  const hasPublishedFlag =
    payload !== null && Object.prototype.hasOwnProperty.call(payload, "is_published");
  const isPublished = hasPublishedFlag ? payload?.is_published !== false : undefined;
  return { title, body, imageUrls, isPinned, isPublished };
}

export async function POST(req: Request) {
  try {
    const service = createServiceClient();
    const competitionId = await resolveCompetitionIdForAdminRequest(req, service);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const userId = await getUserIdFromBearer(req);
    if (!userId) {
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }
    const isAdmin = await userHasAdminRole({ userId, competitionId, supabase: service });
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const payload = (await req.json().catch(() => null)) as AnnouncementPayload | null;
    const normalized = normalizeAnnouncementPayload(payload);
    const title = normalized.title;
    const body = normalized.body;
    const imageUrls = normalized.imageUrls;
    const isPinned = normalized.isPinned;
    const isPublished = normalized.isPublished ?? true;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!body) {
      return NextResponse.json({ error: "Body is required" }, { status: 400 });
    }

    const insertData: AnnouncementInsert = {
      competition_id: competitionId,
      title,
      body,
      image_urls: imageUrls,
      is_pinned: isPinned,
      is_published: isPublished,
      created_by_user_id: userId,
      published_at_utc: new Date().toISOString(),
    };

    const { data, error } = await service
      .from("announcements")
      .insert(insertData)
      .select(
        "id, competition_id, title, body, image_urls, is_pinned, is_published, published_at_utc, created_at, created_by_user_id"
      )
      .single();

    if (error || !data) {
      const errCode = error && "code" in error ? String(error.code ?? "") : "";
      if (error && isMissingAnnouncementsTableError(error.message, errCode)) {
        return NextResponse.json(
          {
            error: "Announcements are not set up yet.",
            hint: "Apply migration db/migrations/20260325_announcements.sql",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to create announcement", details: error?.message ?? "Unknown error" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      row: {
        id: String(data.id),
        competition_id: data.competition_id ? String(data.competition_id) : null,
        title: String(data.title ?? ""),
        body: String(data.body ?? ""),
        image_urls: Array.isArray(data.image_urls) ? data.image_urls : [],
        is_pinned: !!data.is_pinned,
        is_published: !!data.is_published,
        published_at_utc: data.published_at_utc,
        created_at: data.created_at,
        created_by_user_id: data.created_by_user_id ? String(data.created_by_user_id) : null,
      },
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create announcement", details },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const service = createServiceClient();
    const competitionId = await resolveCompetitionIdForAdminRequest(req, service);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const userId = await getUserIdFromBearer(req);
    if (!userId) {
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }
    const isAdmin = await userHasAdminRole({ userId, competitionId, supabase: service });
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const url = new URL(req.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Announcement id is required" }, { status: 400 });
    }

    const payload = (await req.json().catch(() => null)) as AnnouncementPayload | null;
    const normalized = normalizeAnnouncementPayload(payload);
    const title = normalized.title;
    const body = normalized.body;
    const imageUrls = normalized.imageUrls;
    const isPinned = normalized.isPinned;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!body) {
      return NextResponse.json({ error: "Body is required" }, { status: 400 });
    }

    const updateData: AnnouncementUpdate = {
      title,
      body,
      image_urls: imageUrls,
      is_pinned: isPinned,
      updated_at: new Date().toISOString(),
    };
    if (typeof normalized.isPublished === "boolean") {
      updateData.is_published = normalized.isPublished;
    }

    const { data, error } = await service
      .from("announcements")
      .update(updateData)
      .eq("id", id)
      .eq("competition_id", competitionId)
      .select(
        "id, competition_id, title, body, image_urls, is_pinned, is_published, published_at_utc, created_at, created_by_user_id"
      )
      .maybeSingle();

    if (error) {
      const errCode = "code" in error ? String(error.code ?? "") : "";
      if (isMissingAnnouncementsTableError(error.message, errCode)) {
        return NextResponse.json(
          {
            error: "Announcements are not set up yet.",
            hint: "Apply migration db/migrations/20260325_announcements.sql",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to update announcement", details: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Announcement not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      row: {
        id: String(data.id),
        competition_id: data.competition_id ? String(data.competition_id) : null,
        title: String(data.title ?? ""),
        body: String(data.body ?? ""),
        image_urls: Array.isArray(data.image_urls) ? data.image_urls : [],
        is_pinned: !!data.is_pinned,
        is_published: !!data.is_published,
        published_at_utc: data.published_at_utc,
        created_at: data.created_at,
        created_by_user_id: data.created_by_user_id ? String(data.created_by_user_id) : null,
      },
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update announcement", details },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const service = createServiceClient();
    const competitionId = await resolveCompetitionIdForAdminRequest(req, service);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const userId = await getUserIdFromBearer(req);
    if (!userId) {
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }
    const isAdmin = await userHasAdminRole({ userId, competitionId, supabase: service });
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const url = new URL(req.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Announcement id is required" }, { status: 400 });
    }

    const { error } = await service
      .from("announcements")
      .delete()
      .eq("id", id)
      .eq("competition_id", competitionId);

    if (error) {
      const errCode = "code" in error ? String(error.code ?? "") : "";
      if (isMissingAnnouncementsTableError(error.message, errCode)) {
        return NextResponse.json(
          {
            error: "Announcements are not set up yet.",
            hint: "Apply migration db/migrations/20260325_announcements.sql",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to delete announcement", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, id });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to delete announcement", details },
      { status: 500 }
    );
  }
}
