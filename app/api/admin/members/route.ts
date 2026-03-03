import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function requireAdmin(req: Request) {
  const token = getBearer(req);
  if (!token) {
    return { ok: false as const, status: 401, json: { error: "Missing Bearer token" } };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!url || !anon) {
    return { ok: false as const, status: 500, json: { error: "Missing Supabase env vars" } };
  }
  if (!adminEmail) {
    return { ok: false as const, status: 500, json: { error: "Missing env var: ADMIN_EMAIL" } };
  }

  // Validate the session token and get the user
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anon,
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!userRes.ok) {
    return { ok: false as const, status: 401, json: { error: "Invalid session" } };
  }

  const user = (await userRes.json()) as { email?: string; id?: string };
  if (!user?.email || user.email.toLowerCase() !== adminEmail.toLowerCase()) {
    return { ok: false as const, status: 403, json: { error: "Admin only" } };
  }

  return { ok: true as const, user };
}

async function getAuthEmailByUserId(userId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !service) return null;

  const r = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: service,
      authorization: `Bearer ${service}`,
    },
    cache: "no-store",
  });

  if (!r.ok) return null;
  const j = (await r.json()) as { email?: string };
  return j.email ?? null;
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });

  const supabase = createServiceClient();

  const { data: comp, error: cErr } = await supabase
    .from("competitions")
    .select("id")
    .limit(1)
    .single();

  if (cErr || !comp) {
    return NextResponse.json({ error: "No competition found" }, { status: 404 });
  }

  const { data: members, error: mErr } = await supabase
    .from("memberships")
    .select("user_id, created_at")
    .eq("competition_id", comp.id)
    .order("created_at", { ascending: true });

  if (mErr) {
    return NextResponse.json({ error: "Failed to read memberships", details: mErr.message }, { status: 500 });
  }

  const userIds = (members ?? []).map((m) => m.user_id);

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);

  const profileMap = new Map<string, { display_name: string | null }>();
  (profs ?? []).forEach((p: any) => profileMap.set(p.id, { display_name: p.display_name ?? null }));

  // Fetch emails (best effort)
  const out = [];
  for (const m of members ?? []) {
    const email = await getAuthEmailByUserId(m.user_id);
    const p = profileMap.get(m.user_id);
    out.push({
      user_id: m.user_id,
      email,
      display_name: p?.display_name ?? null,
      joined_at: m.created_at,
    });
  }

  return NextResponse.json({ ok: true, members: out });
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });

  const body = (await req.json().catch(() => null)) as null | {
    user_id?: string;
    display_name?: string;
  };

  const user_id = body?.user_id?.trim();
  const display_name = (body?.display_name ?? "").trim();

  if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

  const supabase = createServiceClient();

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user_id,
      display_name: display_name.length ? display_name : null,
    },
    { onConflict: "id" }
  );

  if (error) return NextResponse.json({ error: "Failed to save display name", details: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });

  const body = (await req.json().catch(() => null)) as null | { user_id?: string };
  const user_id = body?.user_id?.trim();
  if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

  const supabase = createServiceClient();

  const { data: comp, error: cErr } = await supabase
    .from("competitions")
    .select("id")
    .limit(1)
    .single();

  if (cErr || !comp) {
    return NextResponse.json({ error: "No competition found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("competition_id", comp.id)
    .eq("user_id", user_id);

  if (error) return NextResponse.json({ error: "Failed to remove member", details: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}