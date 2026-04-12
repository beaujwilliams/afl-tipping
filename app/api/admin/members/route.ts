import { NextResponse } from "next/server";
import {
  describeMemberAuditChanges,
  recordAdminAuditEvent,
  shortUserLabel,
} from "@/lib/admin-audit";
import { isValidAflTeam } from "@/lib/afl-teams";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import { invalidateRoundTipStatusCache } from "@/lib/round-tip-status-data";

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

async function getCompetitionId(supabase: ReturnType<typeof createServiceClient>, req: Request) {
  return resolveCompetitionIdForAdminRequest(req, supabase);
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
  favorite_team: string | null;
  role: string | null;
  payment_status: string | null;
  is_test_account: boolean;
  joined_at: string;
};

type MembershipRow = {
  user_id: string;
  created_at: string;
  role: string | null;
  payment_status?: string | null;
  is_test_account?: boolean | null;
};

type ProfileMemberRow = {
  id: string;
  display_name: string | null;
  email?: string | null;
  favorite_team?: string | null;
};

type MemberAuditSnapshot = {
  display_name: string | null;
  favorite_team: string | null;
  role: string | null;
  payment_status: string | null;
  is_test_account: boolean | null;
};

type MembershipAuditRow = {
  role: string | null;
  payment_status?: string | null;
  is_test_account?: boolean | null;
};

async function loadMemberAuditSnapshot(
  supabase: ReturnType<typeof createServiceClient>,
  competitionId: string,
  userId: string
): Promise<MemberAuditSnapshot> {
  let membership: MembershipAuditRow | null = null;
  const withAll = await supabase
    .from("memberships")
    .select("role, payment_status, is_test_account")
    .eq("competition_id", competitionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (withAll.error) {
    const fallbackCols = [
      "role",
      ...(isMissingColumnError(withAll.error.message, "payment_status") ? [] : ["payment_status"]),
      ...(isMissingColumnError(withAll.error.message, "is_test_account") ? [] : ["is_test_account"]),
    ];

    if (fallbackCols.length > 0) {
      const fallback = await supabase
        .from("memberships")
        .select(fallbackCols.join(", "))
        .eq("competition_id", competitionId)
        .eq("user_id", userId)
        .maybeSingle();
      membership = (fallback.data as MembershipAuditRow | null) ?? null;
    }
  } else {
    membership = (withAll.data as MembershipAuditRow | null) ?? null;
  }

  let profileData: { display_name?: string | null; favorite_team?: string | null } | null = null;
  const profileWithTeam = await supabase
    .from("profiles")
    .select("display_name, favorite_team")
    .eq("id", userId)
    .maybeSingle();

  if (
    profileWithTeam.error &&
    isMissingColumnError(profileWithTeam.error.message, "favorite_team")
  ) {
    const profileFallback = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    profileData =
      (profileFallback.data as { display_name?: string | null } | null) ?? null;
  } else {
    profileData =
      (profileWithTeam.data as
        | { display_name?: string | null; favorite_team?: string | null }
        | null) ?? null;
  }

  return {
    display_name: profileData?.display_name ?? null,
    favorite_team: profileData?.favorite_team ?? null,
    role: membership?.role ?? null,
    payment_status: membership?.payment_status ?? null,
    is_test_account:
      typeof membership?.is_test_account === "boolean" ? membership.is_test_account : null,
  };
}

export async function GET(req: Request) {
  try {
    const supabase = createServiceClient();

    const competitionId = await getCompetitionId(supabase, req);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }
    const admin = await requireAdminOrCron(req, { competitionId });
    if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });

    let members: MembershipRow[] | null = null;
    let mErr: { message: string } | null = null;
    let hasPaymentStatus = true;
    let hasTestFlag = true;

    const withPaymentAndTest = await supabase
      .from("memberships")
      .select("user_id, created_at, role, payment_status, is_test_account")
      .eq("competition_id", competitionId)
      .order("created_at", { ascending: true });

    if (
      withPaymentAndTest.error &&
      (isMissingColumnError(withPaymentAndTest.error.message, "payment_status") ||
        isMissingColumnError(withPaymentAndTest.error.message, "is_test_account"))
    ) {
      hasPaymentStatus = !isMissingColumnError(
        withPaymentAndTest.error.message,
        "payment_status"
      );
      hasTestFlag = !isMissingColumnError(
        withPaymentAndTest.error.message,
        "is_test_account"
      );
      const fallbackColumns = [
        "user_id",
        "created_at",
        "role",
        ...(hasPaymentStatus ? ["payment_status"] : []),
        ...(hasTestFlag ? ["is_test_account"] : []),
      ];
      const fallback = await supabase
        .from("memberships")
        .select(fallbackColumns.join(", "))
        .eq("competition_id", competitionId)
        .order("created_at", { ascending: true });
      members = (fallback.data as unknown as MembershipRow[] | null) ?? null;
      mErr = fallback.error ? { message: fallback.error.message } : null;
    } else {
      members = (withPaymentAndTest.data as unknown as MembershipRow[] | null) ?? null;
      mErr = withPaymentAndTest.error
        ? { message: withPaymentAndTest.error.message }
        : null;
    }

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

    // Try to read profiles including email/favorite team (if schema has them)
    let profRows: ProfileMemberRow[] = [];
    let profilesHaveEmail = true;
    let profilesHaveFavoriteTeam = true;

    const tryWithAll = await supabase
      .from("profiles")
      .select("id, display_name, email, favorite_team")
      .in("id", userIds);

    if (tryWithAll.error) {
      profilesHaveEmail = !isMissingColumnError(tryWithAll.error.message, "email");
      profilesHaveFavoriteTeam = !isMissingColumnError(tryWithAll.error.message, "favorite_team");

      const fallbackColumns = [
        "id",
        "display_name",
        ...(profilesHaveEmail ? ["email"] : []),
        ...(profilesHaveFavoriteTeam ? ["favorite_team"] : []),
      ];

      const fallback = await supabase
        .from("profiles")
        .select(fallbackColumns.join(", "))
        .in("id", userIds);

      if (!fallback.error) profRows = (fallback.data as unknown as ProfileMemberRow[] | null) ?? [];
    } else {
      profRows = (tryWithAll.data as unknown as ProfileMemberRow[] | null) ?? [];
    }

    const profileMap = new Map<
      string,
      { display_name: string | null; email: string | null; favorite_team: string | null }
    >();
    for (const p of profRows) {
      profileMap.set(String(p.id), {
        display_name: p.display_name ?? null,
        email: profilesHaveEmail ? (p.email ?? null) : null,
        favorite_team: profilesHaveFavoriteTeam ? (p.favorite_team ?? null) : null,
      });
    }

    // Build output; if profiles.email is missing, fetch auth emails with limited concurrency
    let out: MemberOut[] = memberRows.map((m) => {
      const p = profileMap.get(String(m.user_id));
      return {
        user_id: String(m.user_id),
        email: p?.email ?? null,
        display_name: p?.display_name ?? null,
        favorite_team: p?.favorite_team ?? null,
        role: m.role ?? null,
        payment_status: hasPaymentStatus ? m.payment_status ?? "pending" : "pending",
        is_test_account: hasTestFlag ? Boolean(m.is_test_account) : false,
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
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Unexpected error", details: e instanceof Error ? e.message : String(e) },
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
      favorite_team?: string | null;
      role?: string;
      payment_status?: string;
      is_test_account?: boolean;
    };

    const user_id = body?.user_id?.trim();
    const display_name =
      typeof body?.display_name === "string" ? body.display_name.trim() : undefined;
    const role =
      typeof body?.role === "string" ? body.role.trim().toLowerCase() : undefined;
    const hasFavoriteTeam = !!body && Object.prototype.hasOwnProperty.call(body, "favorite_team");
    const rawFavoriteTeam = hasFavoriteTeam ? body?.favorite_team : undefined;
    if (
      rawFavoriteTeam !== undefined &&
      rawFavoriteTeam !== null &&
      typeof rawFavoriteTeam !== "string"
    ) {
      return NextResponse.json({ error: "Invalid favorite_team" }, { status: 400 });
    }
    const favorite_team = hasFavoriteTeam
      ? typeof rawFavoriteTeam === "string"
        ? rawFavoriteTeam.trim() || null
        : null
      : undefined;
    const payment_status =
      typeof body?.payment_status === "string"
        ? body.payment_status.trim().toLowerCase()
        : undefined;
    const is_test_account =
      typeof body?.is_test_account === "boolean" ? body.is_test_account : undefined;

    if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    if (
      display_name === undefined &&
      favorite_team === undefined &&
      role === undefined &&
      payment_status === undefined &&
      is_test_account === undefined
    ) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    if (role !== undefined && !["owner", "admin", "member"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (
      payment_status !== undefined &&
      !["paid", "pending", "waived"].includes(payment_status)
    ) {
      return NextResponse.json({ error: "Invalid payment_status" }, { status: 400 });
    }
    if (favorite_team && !isValidAflTeam(favorite_team)) {
      return NextResponse.json({ error: "Invalid favorite team selection" }, { status: 400 });
    }
    const competitionId = await getCompetitionId(supabase, req);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }
    const admin = await requireAdminOrCron(req, { competitionId });
    if (!admin.ok) return NextResponse.json(admin.json, { status: admin.status });
    const actorUserId = admin.mode === "bearer" ? admin.userId : null;
    const beforeSnapshot = await loadMemberAuditSnapshot(supabase, competitionId, user_id);

    if (display_name !== undefined || favorite_team !== undefined) {
      const profileUpdate: { id: string; display_name?: string | null; favorite_team?: string | null } = {
        id: user_id,
      };
      if (display_name !== undefined) {
        profileUpdate.display_name = display_name.length ? display_name : null;
      }
      if (favorite_team !== undefined) {
        profileUpdate.favorite_team = favorite_team;
      }

      const { error } = await supabase.from("profiles").upsert(
        profileUpdate,
        { onConflict: "id" }
      );

      if (error) {
        if (
          favorite_team !== undefined &&
          isMissingColumnError(error.message, "favorite_team")
        ) {
          return NextResponse.json(
            {
              error: "Database is missing favorite_team column",
              details:
                "Run db/migrations/20260307_profiles_favorite_team.sql and redeploy.",
            },
            { status: 500 }
          );
        }

        return NextResponse.json(
          { error: "Failed to save profile fields", details: error.message },
          { status: 500 }
        );
      }
    }

    if (role !== undefined || payment_status !== undefined || is_test_account !== undefined) {
      if (payment_status !== undefined || is_test_account !== undefined) {
        const checkColumns = [
          ...(payment_status !== undefined ? ["payment_status"] : []),
          ...(is_test_account !== undefined ? ["is_test_account"] : []),
        ];
        // Check column availability before attempting update so we can return a clearer error.
        const check = await supabase
          .from("memberships")
          .select(checkColumns.join(", "))
          .eq("competition_id", competitionId)
          .limit(1);

        if (check.error && isMissingColumnError(check.error.message, "payment_status")) {
          return NextResponse.json(
            {
              error: "Database is missing memberships.payment_status",
              details:
                "Run db/migrations/20260307_memberships_payment_status.sql and redeploy.",
            },
            { status: 500 }
          );
        }
        if (check.error && isMissingColumnError(check.error.message, "is_test_account")) {
          return NextResponse.json(
            {
              error: "Database is missing memberships.is_test_account",
              details:
                "Run db/migrations/20260326_memberships_is_test_account.sql and redeploy.",
            },
            { status: 500 }
          );
        }
      }

      const update: { role?: string; payment_status?: string; is_test_account?: boolean } = {};
      if (role !== undefined) update.role = role;
      if (payment_status !== undefined) update.payment_status = payment_status;
      if (is_test_account !== undefined) update.is_test_account = is_test_account;

      const { error } = await supabase
        .from("memberships")
        .update(update)
        .eq("competition_id", competitionId)
        .eq("user_id", user_id);

      if (error) {
        return NextResponse.json(
          { error: "Failed to save role", details: error.message },
          { status: 500 }
        );
      }
    }

    try {
      await invalidateRoundTipStatusCache({
        competitionId,
        supabase,
      });
    } catch (cacheErr) {
      console.warn("round tip status cache invalidation failed", cacheErr);
    }

    const afterSnapshot = {
      display_name:
        display_name !== undefined
          ? display_name.length
            ? display_name
            : null
          : beforeSnapshot.display_name,
      favorite_team:
        favorite_team !== undefined ? favorite_team : beforeSnapshot.favorite_team,
      role: role !== undefined ? role : beforeSnapshot.role,
      payment_status:
        payment_status !== undefined ? payment_status : beforeSnapshot.payment_status,
      is_test_account:
        is_test_account !== undefined ? is_test_account : beforeSnapshot.is_test_account,
    };
    const changes = describeMemberAuditChanges({
      before: beforeSnapshot,
      after: afterSnapshot,
    });
    const targetLabel =
      afterSnapshot.display_name ??
      beforeSnapshot.display_name ??
      shortUserLabel(user_id);
    const auditError = await recordAdminAuditEvent({
      competitionId,
      actionType: "member_updated",
      actorMode: admin.mode,
      actorUserId,
      targetType: "member",
      targetUserId: user_id,
      targetLabel,
      summary:
        changes.length > 0
          ? `Updated member ${targetLabel}: ${changes.join("; ")}.`
          : `Saved member ${targetLabel} without detected field changes.`,
      requestPath: new URL(req.url).pathname + new URL(req.url).search,
      details: {
        before: beforeSnapshot,
        after: afterSnapshot,
        changed_fields: changes,
      },
    });
    if (auditError) {
      console.warn("admin audit log failed after member update", auditError);
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Unexpected error", details: e instanceof Error ? e.message : String(e) },
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
    const actorUserId = admin.mode === "bearer" ? admin.userId : null;
    const beforeSnapshot = await loadMemberAuditSnapshot(supabase, competitionId, user_id);

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

    try {
      await invalidateRoundTipStatusCache({
        competitionId,
        supabase,
      });
    } catch (cacheErr) {
      console.warn("round tip status cache invalidation failed", cacheErr);
    }

    const targetLabel = beforeSnapshot.display_name ?? shortUserLabel(user_id);
    const auditError = await recordAdminAuditEvent({
      competitionId,
      actionType: "member_removed",
      actorMode: admin.mode,
      actorUserId,
      targetType: "member",
      targetUserId: user_id,
      targetLabel,
      summary: `Removed member ${targetLabel} from the competition.`,
      requestPath: new URL(req.url).pathname + new URL(req.url).search,
      details: {
        removed_member: beforeSnapshot,
      },
    });
    if (auditError) {
      console.warn("admin audit log failed after member removal", auditError);
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Unexpected error", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
