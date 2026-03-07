import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron } from "@/lib/admin-auth";

async function getCompetitionId(supabase: ReturnType<typeof createServiceClient>, req: Request) {
  const url = new URL(req.url);
  const fromQS = url.searchParams.get("competition_id")?.trim();
  if (fromQS) return fromQS;

  // fallback: first competition (MVP)
  const { data: comp, error: cErr } = await supabase
    .from("competitions")
    .select("id")
    .limit(1)
    .single();

  if (cErr || !comp) return null;
  return comp.id as string;
}

// Simple concurrency limiter for fallback email lookups
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });

  await Promise.all(workers);
  return out;
}

async function getAuthEmailByUserId(userId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;

  const r = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: service, authorization: `Bearer ${service}` },
    cache: "no-store",
  });

  if (!r.ok) return null;
  const j = (await r.json()) as { email?: string };
  return j.email ?? null;
}

type MemberOut = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  joined_at: string;
};

type MembershipRow = {
  user_id: string;
  created_at: string;
  role: string | null;
};

export async function GET(req: Request) {
  try {
    const supabase = createServiceClient();

    const competitionId = await getCompetitionId(supabase, req);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }
    const admin = await requireAdminOrCron(req, { competitionId });
    if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });

    const { data: members, error: mErr } = await supabase
      .from("memberships")
      .select("user_id, created_at, role")
      .eq("competition_id", competitionId)
      .order("created_at", { ascending: true });

    if (mErr) {
      return NextResponse.json(
        { error: "Failed to read memberships", details: mErr.message },
        { status: 500 }
      );
    }

    const memberRows = (members ?? []) as MembershipRow[];
    const userIds = memberRows.map((m) => String(m.user_id));
    if (userIds.length === 0) {
      return NextResponse.json({ ok: true, competition_id: competitionId, members: [] });
    }

    // Try to read profiles including email (if your schema has it)
    let profRows: any[] = [];
    let profilesHaveEmail = true;

    const tryWithEmail = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", userIds);

    if (tryWithEmail.error) {
      profilesHaveEmail = false;
      const fallback = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);

      if (!fallback.error) profRows = (fallback.data as any[]) ?? [];
    } else {
      profRows = (tryWithEmail.data as any[]) ?? [];
    }

    const profileMap = new Map<string, { display_name: string | null; email: string | null }>();
    for (const p of profRows) {
      profileMap.set(String(p.id), {
        display_name: p.display_name ?? null,
        email: profilesHaveEmail ? (p.email ?? null) : null,
      });
    }

    // Build output; if profiles.email is missing, fetch auth emails with limited concurrency
    let out: MemberOut[] = memberRows.map((m) => {
      const p = profileMap.get(String(m.user_id));
      return {
        user_id: String(m.user_id),
        email: p?.email ?? null,
        display_name: p?.display_name ?? null,
        role: m.role ?? null,
        joined_at: String(m.created_at),
      };
    });

    if (!profilesHaveEmail) {
      out = await mapLimit(out, 5, async (row) => {
        const email = await getAuthEmailByUserId(row.user_id);
        return { ...row, email };
      });
    }

    return NextResponse.json({ ok: true, competition_id: competitionId, members: out });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = createServiceClient();

    const body = (await req.json().catch(() => null)) as null | {
      user_id?: string;
      display_name?: string;
      role?: string;
    };

    const user_id = body?.user_id?.trim();
    const display_name =
      typeof body?.display_name === "string" ? body.display_name.trim() : undefined;
    const role =
      typeof body?.role === "string" ? body.role.trim().toLowerCase() : undefined;

    if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    if (display_name === undefined && role === undefined) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    if (role !== undefined && !["owner", "admin", "member"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    const competitionId = await getCompetitionId(supabase, req);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }
    const admin = await requireAdminOrCron(req, { competitionId });
    if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });

    if (display_name !== undefined) {
      const { error } = await supabase.from("profiles").upsert(
        {
          id: user_id,
          display_name: display_name.length ? display_name : null,
        },
        { onConflict: "id" }
      );

      if (error) {
        return NextResponse.json(
          { error: "Failed to save display name", details: error.message },
          { status: 500 }
        );
      }
    }

    if (role !== undefined) {
      const { error } = await supabase
        .from("memberships")
        .update({ role })
        .eq("competition_id", competitionId)
        .eq("user_id", user_id);

      if (error) {
        return NextResponse.json(
          { error: "Failed to save role", details: error.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = createServiceClient();

    const body = (await req.json().catch(() => null)) as null | { user_id?: string };
    const user_id = body?.user_id?.trim();
    if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

    const competitionId = await getCompetitionId(supabase, req);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }
    const admin = await requireAdminOrCron(req, { competitionId });
    if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });

    const { error } = await supabase
      .from("memberships")
      .delete()
      .eq("competition_id", competitionId)
      .eq("user_id", user_id);

    if (error) {
      return NextResponse.json(
        { error: "Failed to remove member", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
