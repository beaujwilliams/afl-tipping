import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";

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

export async function POST(req: Request) {
  try {
    const service = createServiceClient();
    const competitionId = await resolveCompetitionIdForAdminRequest(req, service);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const gate = await requireAdminOrCron(req, { competitionId });
    if (!gate.ok) {
      return NextResponse.json(gate.json, { status: gate.status });
    }

    const payload = (await req.json().catch(() => null)) as
      | {
          title?: unknown;
          body?: unknown;
          image_urls?: unknown;
          is_pinned?: unknown;
          is_published?: unknown;
        }
      | null;

    const title = normalizeText(payload?.title, 140);
    const body = normalizeText(payload?.body, 12000);
    const imageUrls = normalizeImageUrls(payload?.image_urls);
    const isPinned = Boolean(payload?.is_pinned);
    const isPublished = payload?.is_published === false ? false : true;

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
      created_by_user_id: gate.mode === "bearer" ? gate.userId : null,
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

export async function DELETE(req: Request) {
  try {
    const service = createServiceClient();
    const competitionId = await resolveCompetitionIdForAdminRequest(req, service);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const gate = await requireAdminOrCron(req, { competitionId });
    if (!gate.ok) {
      return NextResponse.json(gate.json, { status: gate.status });
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

