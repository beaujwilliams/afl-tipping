import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import {
  canTransitionOnboardingStage,
  deriveOnboardingStage,
  findSuggestedOnboardingLinkCandidate,
  normalizeOnboardingPipelineStage,
  normalizeOnboardingPaymentStatus,
  summarizeOnboardingStages,
  type OnboardingLinkCandidate,
  type OnboardingPipelineStage,
} from "@/lib/onboarding-workflow";
import {
  parseQuickReminderNames,
  reminderNameKey,
} from "@/lib/onboarding-reminders";
import { NEXT_SEASON } from "@/lib/season-config";

type InterestStatus = "pending" | "notified" | "unsubscribed";

type InterestRow = {
  id: string;
  target_season: number;
  email: string | null;
  full_name: string | null;
  status: InterestStatus;
  source: string;
  notes: string | null;
  submitted_at_utc: string;
  created_at: string;
  updated_at: string;
  pipeline_stage?: string | null;
  reviewed_at_utc?: string | null;
  contacted_at_utc?: string | null;
  invited_at_utc?: string | null;
  archived_at_utc?: string | null;
  archived_reason?: string | null;
  linked_user_id?: string | null;
  linked_membership_competition_id?: string | null;
  last_contact_note?: string | null;
};

type MembershipRow = {
  user_id: string;
  payment_status?: string | null;
  role?: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  email?: string | null;
};

function parseSeason(raw: string | null, fallback: number) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return fallback;
  return Math.trunc(parsed);
}

function isMissingColumnError(message: string, columnName: string) {
  const m = String(message ?? "").toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

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

async function assertAdmin(req: Request) {
  const supabase = createServiceClient();
  const competitionId = await resolveCompetitionIdForAdminRequest(req, supabase);
  if (!competitionId) {
    return { ok: false as const, res: NextResponse.json({ error: "No competition found" }, { status: 404 }) };
  }

  const admin = await requireAdminOrCron(req, { competitionId });
  if (!admin.ok) {
    return { ok: false as const, res: NextResponse.json(admin.json, { status: admin.status }) };
  }

  return { ok: true as const, supabase, competitionId };
}

function baseInterestSelect() {
  return [
    "id",
    "target_season",
    "email",
    "full_name",
    "status",
    "source",
    "notes",
    "submitted_at_utc",
    "created_at",
    "updated_at",
    "pipeline_stage",
    "reviewed_at_utc",
    "contacted_at_utc",
    "invited_at_utc",
    "archived_at_utc",
    "archived_reason",
    "linked_user_id",
    "linked_membership_competition_id",
    "last_contact_note",
  ].join(",");
}

async function loadInterestRows(
  supabase: ReturnType<typeof createServiceClient>,
  season: number
) {
  const result = await supabase
    .from("next_season_interest")
    .select(baseInterestSelect())
    .eq("target_season", season)
    .order("submitted_at_utc", { ascending: false })
    .limit(1000);

  if (!result.error) {
    return ((result.data ?? []) as unknown as InterestRow[]);
  }

  if (isMissingRelationError(result.error.message, "next_season_interest")) {
    throw new Error(
      "Database is missing next_season_interest table. Run db/migrations/20260326_next_season_interest.sql and redeploy."
    );
  }

  if (isMissingColumnError(result.error.message, "pipeline_stage")) {
    throw new Error(
      "Database is missing onboarding fields. Run db/migrations/20260409_next_season_interest_onboarding.sql and redeploy."
    );
  }

  throw new Error(`Failed to read onboarding rows: ${result.error.message}`);
}

async function loadMemberDirectory(
  supabase: ReturnType<typeof createServiceClient>,
  competitionId: string
) {
  let memberships: MembershipRow[] = [];

  const withPayment = await supabase
    .from("memberships")
    .select("user_id, payment_status, role")
    .eq("competition_id", competitionId);

  if (withPayment.error && isMissingColumnError(withPayment.error.message, "payment_status")) {
    const fallback = await supabase.from("memberships").select("user_id, role").eq("competition_id", competitionId);
    if (fallback.error) {
      throw new Error(`Failed to read member directory: ${fallback.error.message}`);
    }
    memberships = ((fallback.data ?? []) as unknown as MembershipRow[]);
  } else if (withPayment.error) {
    throw new Error(`Failed to read member directory: ${withPayment.error.message}`);
  } else {
    memberships = ((withPayment.data ?? []) as unknown as MembershipRow[]);
  }

  const userIds = memberships.map((row) => String(row.user_id)).filter(Boolean);
  if (userIds.length === 0) return new Map<string, OnboardingLinkCandidate>();

  let profileRows: ProfileRow[] = [];
  let profilesHaveEmail = true;
  const withEmail = await supabase.from("profiles").select("id, display_name, email").in("id", userIds);

  if (withEmail.error) {
    profilesHaveEmail = false;
    const fallback = await supabase.from("profiles").select("id, display_name").in("id", userIds);
    if (fallback.error) {
      throw new Error(`Failed to read member profiles: ${fallback.error.message}`);
    }
    profileRows = ((fallback.data ?? []) as unknown as ProfileRow[]);
  } else {
    profileRows = ((withEmail.data ?? []) as unknown as ProfileRow[]);
  }

  const profileMap = new Map<string, { display_name: string | null; email: string | null }>();
  profileRows.forEach((row) => {
    profileMap.set(String(row.id), {
      display_name: row.display_name ?? null,
      email: profilesHaveEmail ? (row.email ?? null) : null,
    });
  });

  let members = memberships.map((row) => {
    const userId = String(row.user_id);
    const profile = profileMap.get(userId);
    return {
      user_id: userId,
      email: profile?.email ?? null,
      display_name: profile?.display_name ?? null,
      payment_status: normalizeOnboardingPaymentStatus(row.payment_status ?? null),
      role: row.role ?? null,
    } satisfies OnboardingLinkCandidate;
  });

  if (!profilesHaveEmail) {
    members = await mapLimit(members, 5, async (row) => ({
      ...row,
      email: await getAuthEmailByUserId(row.user_id),
    }));
  }

  return new Map(members.map((row) => [row.user_id, row] as const));
}

async function buildOnboardingResponse(params: {
  supabase: ReturnType<typeof createServiceClient>;
  competitionId: string;
  season: number;
  rows?: InterestRow[];
}) {
  const rows = params.rows ?? (await loadInterestRows(params.supabase, params.season));
  const memberDirectory = await loadMemberDirectory(params.supabase, params.competitionId);
  const memberList = Array.from(memberDirectory.values());

  const enrichedRows = rows.map((row) => {
    const linkedMember = row.linked_user_id
      ? memberDirectory.get(String(row.linked_user_id)) ?? null
      : null;
    const suggestedMember = findSuggestedOnboardingLinkCandidate({
      interestEmail: row.email,
      currentLinkedUserId: row.linked_user_id ?? null,
      members: memberList,
    });
    const derivedStage = deriveOnboardingStage({
      pipelineStage: row.pipeline_stage ?? null,
      interestStatus: row.status ?? null,
      linkedUserId: row.linked_user_id ?? null,
      membershipPaymentStatus: linkedMember?.payment_status ?? null,
    });

    return {
      ...row,
      pipeline_stage: normalizeOnboardingPipelineStage(row.pipeline_stage ?? null),
      derived_stage: derivedStage,
      linked_member: linkedMember
        ? {
            user_id: linkedMember.user_id,
            display_name: linkedMember.display_name,
            email: linkedMember.email,
            payment_status: linkedMember.payment_status,
            role: linkedMember.role,
          }
        : null,
      suggested_link_member: suggestedMember
        ? {
            user_id: suggestedMember.user_id,
            display_name: suggestedMember.display_name,
            email: suggestedMember.email,
            payment_status: suggestedMember.payment_status,
            role: suggestedMember.role,
          }
        : null,
    };
  });

  return {
    ok: true as const,
    competition_id: params.competitionId,
    season: params.season,
    rows: enrichedRows,
    summary: summarizeOnboardingStages(
      enrichedRows.map((row) => ({
        pipelineStage: row.pipeline_stage,
        interestStatus: row.status,
        linkedUserId: row.linked_user_id ?? null,
        membershipPaymentStatus: row.linked_member?.payment_status ?? null,
      }))
    ),
  };
}

export async function GET(req: Request) {
  try {
    const adminCheck = await assertAdmin(req);
    if (!adminCheck.ok) return adminCheck.res;

    const url = new URL(req.url);
    const season = parseSeason(url.searchParams.get("season"), NEXT_SEASON);

    return NextResponse.json(
      await buildOnboardingResponse({
        supabase: adminCheck.supabase,
        competitionId: adminCheck.competitionId,
        season,
      })
    );
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "Unexpected error", details }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const adminCheck = await assertAdmin(req);
    if (!adminCheck.ok) return adminCheck.res;

    const body = (await req.json().catch(() => null)) as
      | null
      | {
          season?: number;
          names?: unknown;
        };
    const season = parseSeason(String(body?.season ?? ""), NEXT_SEASON);
    const parsed = parseQuickReminderNames(body?.names);

    if (parsed.names.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Enter at least one name, with one person per line." },
        { status: 400 }
      );
    }

    const existingResult = await adminCheck.supabase
      .from("next_season_interest")
      .select("full_name")
      .eq("target_season", season)
      .is("email_normalized", null)
      .limit(1000);

    if (existingResult.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to check existing manual reminders",
          details: existingResult.error.message,
        },
        { status: 500 }
      );
    }

    const existingNameKeys = new Set(
      (existingResult.data ?? [])
        .map((row) => reminderNameKey(String(row.full_name ?? "")))
        .filter(Boolean)
    );
    const namesToAdd = parsed.names.filter((name) => !existingNameKeys.has(reminderNameKey(name)));
    const skippedExistingCount = parsed.names.length - namesToAdd.length;

    if (namesToAdd.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        added_count: 0,
        skipped_existing_count: skippedExistingCount,
        duplicate_input_count: parsed.duplicateCount,
        overflow_count: parsed.overflowCount,
      });
    }

    const nowIso = new Date().toISOString();
    const insert = await adminCheck.supabase
      .from("next_season_interest")
      .insert(
        namesToAdd.map((fullName) => ({
          target_season: season,
          email: null,
          email_normalized: null,
          full_name: fullName,
          source: "admin_added",
          status: "pending",
          pipeline_stage: "new",
          submitted_at_utc: nowIso,
          updated_at: nowIso,
        }))
      )
      .select("id");

    if (insert.error) {
      const migrationHint =
        insert.error.code === "23502" ||
        (insert.error.message.toLowerCase().includes("email") &&
          insert.error.message.toLowerCase().includes("null"));
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to add manual reminders",
          details: migrationHint
            ? "Run db/migrations/20260808_name_only_onboarding_reminders.sql and redeploy."
            : insert.error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      season,
      added_count: insert.data?.length ?? namesToAdd.length,
      skipped_existing_count: skippedExistingCount,
      duplicate_input_count: parsed.duplicateCount,
      overflow_count: parsed.overflowCount,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "Unexpected error", details }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const adminCheck = await assertAdmin(req);
    if (!adminCheck.ok) return adminCheck.res;

    const body = (await req.json().catch(() => null)) as
      | null
      | {
          id?: string;
          pipeline_stage?: OnboardingPipelineStage;
          notes?: string | null;
          last_contact_note?: string | null;
          archived_reason?: string | null;
          linked_user_id?: string | null;
          unlink_user?: boolean;
        };

    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }

    const current = await adminCheck.supabase
      .from("next_season_interest")
      .select(baseInterestSelect())
      .eq("id", id)
      .maybeSingle();

    if (current.error) {
      return NextResponse.json(
        { ok: false, error: "Failed to load onboarding row", details: current.error.message },
        { status: 500 }
      );
    }

    const existing = (current.data as InterestRow | null) ?? null;
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Onboarding row not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body?.notes !== undefined) {
      const text = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";
      updates.notes = text || null;
    }

    if (body?.last_contact_note !== undefined) {
      const text =
        typeof body.last_contact_note === "string"
          ? body.last_contact_note.trim().slice(0, 2000)
          : "";
      updates.last_contact_note = text || null;
    }

    if (body?.archived_reason !== undefined) {
      const text =
        typeof body.archived_reason === "string"
          ? body.archived_reason.trim().slice(0, 500)
          : "";
      updates.archived_reason = text || null;
    }

    const isLinked = String(existing.linked_user_id ?? "").trim().length > 0;
    if (body?.pipeline_stage) {
      const nextStage = normalizeOnboardingPipelineStage(body.pipeline_stage);

      if (isLinked) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Linked rows derive their live outcome from membership state. Unlink first to edit the pipeline stage.",
          },
          { status: 409 }
        );
      }

      const currentStage = deriveOnboardingStage({
        pipelineStage: existing.pipeline_stage ?? null,
        interestStatus: existing.status ?? null,
        linkedUserId: existing.linked_user_id ?? null,
        membershipPaymentStatus: null,
      });

      if (!canTransitionOnboardingStage({ from: currentStage, to: nextStage })) {
        return NextResponse.json(
          { ok: false, error: `Invalid stage transition: ${currentStage} -> ${nextStage}` },
          { status: 400 }
        );
      }

      updates.pipeline_stage = nextStage;
      if (nextStage === "reviewed" && !existing.reviewed_at_utc) {
        updates.reviewed_at_utc = new Date().toISOString();
      }
      if (nextStage === "contacted") {
        updates.contacted_at_utc = new Date().toISOString();
      }
      if (nextStage === "invited") {
        updates.invited_at_utc = new Date().toISOString();
      }
      if (nextStage === "archived") {
        updates.archived_at_utc = new Date().toISOString();
      } else {
        updates.archived_at_utc = null;
        if (body?.archived_reason === undefined) {
          updates.archived_reason = null;
        }
      }
    }

    if (body?.unlink_user === true) {
      updates.linked_user_id = null;
      updates.linked_membership_competition_id = null;
    } else if (typeof body?.linked_user_id === "string" && body.linked_user_id.trim()) {
      const linkedUserId = body.linked_user_id.trim();
      const membership = await adminCheck.supabase
        .from("memberships")
        .select("user_id")
        .eq("competition_id", adminCheck.competitionId)
        .eq("user_id", linkedUserId)
        .maybeSingle();

      if (membership.error) {
        return NextResponse.json(
          { ok: false, error: "Failed to verify linked member", details: membership.error.message },
          { status: 500 }
        );
      }

      if (!membership.data) {
        return NextResponse.json(
          { ok: false, error: "Linked user must already be a member of this competition" },
          { status: 400 }
        );
      }

      updates.linked_user_id = linkedUserId;
      updates.linked_membership_competition_id = adminCheck.competitionId;
    }

    const update = await adminCheck.supabase
      .from("next_season_interest")
      .update(updates)
      .eq("id", id)
      .select(baseInterestSelect())
      .maybeSingle();

    if (update.error) {
      if (isMissingColumnError(update.error.message, "pipeline_stage")) {
        return NextResponse.json(
          {
            ok: false,
            error: "Database is missing onboarding fields",
            details: "Run db/migrations/20260409_next_season_interest_onboarding.sql and redeploy.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { ok: false, error: "Failed to update onboarding row", details: update.error.message },
        { status: 500 }
      );
    }

    const updatedRow = (update.data as InterestRow | null) ?? null;
    if (!updatedRow) {
      return NextResponse.json({ ok: false, error: "Onboarding row not found" }, { status: 404 });
    }

    const json = await buildOnboardingResponse({
      supabase: adminCheck.supabase,
      competitionId: adminCheck.competitionId,
      season: Number(updatedRow.target_season ?? NEXT_SEASON),
      rows: [updatedRow],
    });

    return NextResponse.json({ ok: true, row: json.rows[0] ?? null });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "Unexpected error", details }, { status: 500 });
  }
}
