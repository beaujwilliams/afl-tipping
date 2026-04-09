import { NextResponse } from "next/server";
import { normalizeOnboardingPaymentStatus } from "@/lib/onboarding-workflow";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import { CURRENT_SEASON } from "@/lib/season-config";
import {
  buildLinkedOnboardingPreview,
  getSeasonBuyInCents,
  normalizePaymentMethod,
  normalizePaymentReconciliationStatus,
  suggestPaymentMemberMatches,
  type PaymentMemberCandidate,
  type PaymentOnboardingCandidate,
} from "@/lib/payment-ledger";

type PaymentRecordRow = {
  id: string;
  competition_id: string;
  season: number;
  amount_cents: number;
  payment_method: string;
  payer_name: string | null;
  payer_email: string | null;
  reference_text: string | null;
  notes: string | null;
  paid_at_utc: string;
  recorded_source: string | null;
  reconciliation_status: string;
  matched_user_id: string | null;
  matched_onboarding_id: string | null;
  matched_at_utc: string | null;
  recorded_by_user_id: string | null;
  created_at: string;
  updated_at: string;
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

type OnboardingRow = PaymentOnboardingCandidate & {
  id: string;
  target_season: number;
  status?: string | null;
  pipeline_stage?: string | null;
  linked_user_id?: string | null;
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

  return { ok: true as const, supabase, competitionId, admin };
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
  if (userIds.length === 0) {
    return [] as PaymentMemberCandidate[];
  }

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
    } satisfies PaymentMemberCandidate;
  });

  if (!profilesHaveEmail) {
    members = await mapLimit(members, 5, async (row) => ({
      ...row,
      email: await getAuthEmailByUserId(row.user_id),
    }));
  }

  return members;
}

async function loadOnboardingRows(
  supabase: ReturnType<typeof createServiceClient>,
  season: number,
  paymentStatusByUserId: Map<string, string | null>
) {
  const result = await supabase
    .from("next_season_interest")
    .select("id, target_season, email, full_name, status, pipeline_stage, linked_user_id")
    .eq("target_season", season)
    .limit(1000);

  if (result.error) {
    if (
      isMissingRelationError(result.error.message, "next_season_interest") ||
      isMissingColumnError(result.error.message, "pipeline_stage")
    ) {
      return { rows: [] as OnboardingRow[], hint: "Onboarding linking unavailable until next-season-interest migrations are applied." };
    }
    throw new Error(`Failed to read onboarding rows: ${result.error.message}`);
  }

  const rows = ((result.data ?? []) as unknown as OnboardingRow[]).map((row) => ({
    ...row,
    membership_payment_status: row.linked_user_id
      ? paymentStatusByUserId.get(String(row.linked_user_id)) ?? null
      : null,
  }));

  return { rows, hint: null as string | null };
}

async function loadPaymentRows(
  supabase: ReturnType<typeof createServiceClient>,
  competitionId: string,
  season: number
) {
  const result = await supabase
    .from("payment_records")
    .select(
      "id, competition_id, season, amount_cents, payment_method, payer_name, payer_email, reference_text, notes, paid_at_utc, recorded_source, reconciliation_status, matched_user_id, matched_onboarding_id, matched_at_utc, recorded_by_user_id, created_at, updated_at"
    )
    .eq("competition_id", competitionId)
    .eq("season", season)
    .order("paid_at_utc", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (result.error) {
    if (isMissingRelationError(result.error.message, "payment_records")) {
      throw new Error(
        "Database is missing payment_records table. Run db/migrations/20260409_payment_records.sql and redeploy."
      );
    }
    throw new Error(`Failed to read payment records: ${result.error.message}`);
  }

  return (result.data ?? []) as PaymentRecordRow[];
}

function normalizeCurrencyInputAmount(value: unknown) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  const cents = Math.round(raw * 100);
  if (cents <= 0) return null;
  return cents;
}

export async function GET(req: Request) {
  try {
    const adminResult = await assertAdmin(req);
    if (!adminResult.ok) return adminResult.res;

    const url = new URL(req.url);
    const season = parseSeason(url.searchParams.get("season"), CURRENT_SEASON);
    const { supabase, competitionId } = adminResult;

    const members = await loadMemberDirectory(supabase, competitionId);
    const memberMap = new Map(members.map((member) => [member.user_id, member] as const));
    const paymentStatusByUserId = new Map(
      members.map((member) => [member.user_id, member.payment_status ?? null] as const)
    );

    const payments = await loadPaymentRows(supabase, competitionId, season);
    const onboardingResult = await loadOnboardingRows(supabase, season, paymentStatusByUserId);
    const onboardingMap = new Map(onboardingResult.rows.map((row) => [row.id, row] as const));

    const rows = payments.map((payment) => {
      const matchedMember = payment.matched_user_id
        ? memberMap.get(String(payment.matched_user_id)) ?? null
        : null;
      const matchedOnboarding = payment.matched_onboarding_id
        ? buildLinkedOnboardingPreview(onboardingMap.get(String(payment.matched_onboarding_id)) ?? null)
        : null;

      return {
        ...payment,
        payment_method: normalizePaymentMethod(payment.payment_method),
        reconciliation_status: normalizePaymentReconciliationStatus(payment.reconciliation_status),
        matched_member: matchedMember,
        matched_onboarding: matchedOnboarding,
        suggestions:
          !payment.matched_user_id && normalizePaymentReconciliationStatus(payment.reconciliation_status) !== "ignored"
            ? suggestPaymentMemberMatches({ payment, members, maxSuggestions: 3 })
            : [],
      };
    });

    const summary = rows.reduce(
      (acc, row) => {
        const status = normalizePaymentReconciliationStatus(row.reconciliation_status);
        acc[status] += 1;
        acc.total_amount_cents += Number(row.amount_cents ?? 0);
        if (status === "matched") acc.matched_amount_cents += Number(row.amount_cents ?? 0);
        return acc;
      },
      {
        unmatched: 0,
        matched: 0,
        ignored: 0,
        total_amount_cents: 0,
        matched_amount_cents: 0,
      }
    );

    return NextResponse.json({
      ok: true,
      season,
      buy_in_cents: getSeasonBuyInCents(season),
      summary,
      rows,
      member_options: members,
      hints: {
        onboarding: onboardingResult.hint,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Unexpected error", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const adminResult = await assertAdmin(req);
    if (!adminResult.ok) return adminResult.res;

    const body = (await req.json().catch(() => null)) as
      | null
      | {
          season?: number;
          amount_dollars?: number;
          payment_method?: string;
          payer_name?: string | null;
          payer_email?: string | null;
          reference_text?: string | null;
          notes?: string | null;
          paid_at_utc?: string | null;
        };

    const season = parseSeason(
      body && typeof body.season === "number" ? String(body.season) : null,
      CURRENT_SEASON
    );
    const amountCents = normalizeCurrencyInputAmount(body?.amount_dollars);
    if (!amountCents) {
      return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
    }

    const paidAtUtc = String(body?.paid_at_utc ?? "").trim();
    if (!paidAtUtc || Number.isNaN(new Date(paidAtUtc).getTime())) {
      return NextResponse.json({ error: "paid_at_utc must be a valid date" }, { status: 400 });
    }

    const { supabase, competitionId, admin } = adminResult;
    const insert = await supabase
      .from("payment_records")
      .insert({
        competition_id: competitionId,
        season,
        amount_cents: amountCents,
        payment_method: normalizePaymentMethod(body?.payment_method),
        payer_name: String(body?.payer_name ?? "").trim() || null,
        payer_email: String(body?.payer_email ?? "").trim() || null,
        reference_text: String(body?.reference_text ?? "").trim() || null,
        notes: String(body?.notes ?? "").trim() || null,
        paid_at_utc: new Date(paidAtUtc).toISOString(),
        recorded_source: "manual",
        reconciliation_status: "unmatched",
        recorded_by_user_id: admin.mode === "bearer" ? admin.userId : null,
        updated_at: new Date().toISOString(),
      })
      .select(
        "id, competition_id, season, amount_cents, payment_method, payer_name, payer_email, reference_text, notes, paid_at_utc, recorded_source, reconciliation_status, matched_user_id, matched_onboarding_id, matched_at_utc, recorded_by_user_id, created_at, updated_at"
      )
      .single();

    if (insert.error) {
      if (isMissingRelationError(insert.error.message, "payment_records")) {
        return NextResponse.json(
          {
            error: "Database is missing payment_records table",
            details: "Run db/migrations/20260409_payment_records.sql and redeploy.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to record payment", details: insert.error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, row: insert.data });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Unexpected error", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
