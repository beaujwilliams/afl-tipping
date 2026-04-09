import { NextResponse } from "next/server";
import {
  describeMemberAuditChanges,
  recordAdminAuditEvent,
  shortUserLabel,
} from "@/lib/admin-audit";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import {
  buildLinkedOnboardingPreview,
  findAutoLinkedOnboardingCandidate,
  normalizePaymentReconciliationStatus,
  type PaymentOnboardingCandidate,
} from "@/lib/payment-ledger";
import { createServiceClient } from "@/lib/supabase-server";

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
  reconciliation_status: string;
  matched_user_id: string | null;
  matched_onboarding_id: string | null;
  matched_at_utc: string | null;
};

type MembershipAuditRow = {
  role: string | null;
  payment_status?: string | null;
  is_test_account?: boolean | null;
};

type MemberAuditSnapshot = {
  display_name: string | null;
  role: string | null;
  payment_status: string | null;
  is_test_account: boolean | null;
};

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

  const profile = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  return {
    display_name:
      ((profile.data as { display_name?: string | null } | null)?.display_name ?? null),
    role: membership?.role ?? null,
    payment_status: membership?.payment_status ?? null,
    is_test_account:
      typeof membership?.is_test_account === "boolean" ? membership.is_test_account : null,
  };
}

async function loadMemberEmail(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string
) {
  const withEmail = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (!withEmail.error) {
    const email = ((withEmail.data as { email?: string | null } | null)?.email ?? null);
    if (email) return email;
  }
  return getAuthEmailByUserId(userId);
}

async function tryAutoLinkOnboarding(params: {
  supabase: ReturnType<typeof createServiceClient>;
  competitionId: string;
  season: number;
  matchedUserId: string;
  matchedMemberEmail: string | null;
}) {
  const result = await params.supabase
    .from("next_season_interest")
    .select("id, target_season, email, full_name, status, pipeline_stage, linked_user_id")
    .eq("target_season", params.season)
    .limit(1000);

  if (result.error) {
    if (
      isMissingRelationError(result.error.message, "next_season_interest") ||
      isMissingColumnError(result.error.message, "pipeline_stage")
    ) {
      return null;
    }
    throw new Error(`Failed to read onboarding rows: ${result.error.message}`);
  }

  const rows = ((result.data ?? []) as unknown as PaymentOnboardingCandidate[]).map((row) => ({
    ...row,
    membership_payment_status: "paid",
  }));

  const candidate = findAutoLinkedOnboardingCandidate({
    season: params.season,
    matchedUserId: params.matchedUserId,
    matchedMemberEmail: params.matchedMemberEmail,
    rows,
  });

  if (!candidate) return null;

  const update = await params.supabase
    .from("next_season_interest")
    .update({
      linked_user_id: params.matchedUserId,
      linked_membership_competition_id: params.competitionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", candidate.id)
    .select("id, target_season, email, full_name, status, pipeline_stage, linked_user_id")
    .single();

  if (update.error) {
    throw new Error(`Failed to link onboarding row: ${update.error.message}`);
  }

  return buildLinkedOnboardingPreview({
    ...((update.data ?? {}) as PaymentOnboardingCandidate),
    membership_payment_status: "paid",
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const adminResult = await assertAdmin(req);
    if (!adminResult.ok) return adminResult.res;

    const { id } = await ctx.params;
    const paymentId = String(id ?? "").trim();
    if (!paymentId) {
      return NextResponse.json({ error: "Payment id is required" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as
      | null
      | {
          action?: string;
          user_id?: string | null;
        };

    const action = String(body?.action ?? "").trim().toLowerCase();
    if (!["match", "ignore", "reopen"].includes(action)) {
      return NextResponse.json({ error: "Unsupported payment action" }, { status: 400 });
    }

    const { supabase, competitionId, admin } = adminResult;
    const paymentRes = await supabase
      .from("payment_records")
      .select(
        "id, competition_id, season, amount_cents, payment_method, payer_name, payer_email, reference_text, notes, paid_at_utc, reconciliation_status, matched_user_id, matched_onboarding_id, matched_at_utc"
      )
      .eq("competition_id", competitionId)
      .eq("id", paymentId)
      .maybeSingle();

    if (paymentRes.error) {
      if (isMissingRelationError(paymentRes.error.message, "payment_records")) {
        return NextResponse.json(
          {
            error: "Database is missing payment_records table",
            details: "Run db/migrations/20260409_payment_records.sql and redeploy.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to load payment record", details: paymentRes.error.message },
        { status: 500 }
      );
    }

    const payment = (paymentRes.data as PaymentRecordRow | null) ?? null;
    if (!payment) {
      return NextResponse.json({ error: "Payment record not found" }, { status: 404 });
    }

    const currentStatus = normalizePaymentReconciliationStatus(payment.reconciliation_status);

    if (action === "ignore" || action === "reopen") {
      if (payment.matched_user_id) {
        return NextResponse.json(
          { error: "Matched payment records cannot be ignored or reopened in this first pass" },
          { status: 400 }
        );
      }

      const nextStatus = action === "ignore" ? "ignored" : "unmatched";
      if (currentStatus === nextStatus) {
        return NextResponse.json({ ok: true, status: nextStatus });
      }

      const update = await supabase
        .from("payment_records")
        .update({
          reconciliation_status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .eq("competition_id", competitionId);

      if (update.error) {
        return NextResponse.json(
          { error: `Failed to ${action} payment record`, details: update.error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, status: nextStatus });
    }

    const matchedUserId = String(body?.user_id ?? "").trim();
    if (!matchedUserId) {
      return NextResponse.json({ error: "user_id is required to match a payment" }, { status: 400 });
    }

    if (payment.matched_user_id && payment.matched_user_id !== matchedUserId) {
      return NextResponse.json(
        {
          error:
            "This payment record is already matched. Adjust the member payment status manually first if you need to correct it.",
        },
        { status: 400 }
      );
    }

    if (payment.matched_user_id === matchedUserId) {
      return NextResponse.json({ ok: true, matched_user_id: matchedUserId });
    }

    const membershipRes = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", competitionId)
      .eq("user_id", matchedUserId)
      .maybeSingle();

    if (membershipRes.error) {
      return NextResponse.json(
        { error: "Failed to verify member", details: membershipRes.error.message },
        { status: 500 }
      );
    }

    if (!membershipRes.data) {
      return NextResponse.json({ error: "Selected user is not a member of this competition" }, { status: 400 });
    }

    const beforeSnapshot = await loadMemberAuditSnapshot(supabase, competitionId, matchedUserId);

    const membershipUpdate = await supabase
      .from("memberships")
      .update({ payment_status: "paid" })
      .eq("competition_id", competitionId)
      .eq("user_id", matchedUserId);

    if (membershipUpdate.error) {
      if (isMissingColumnError(membershipUpdate.error.message, "payment_status")) {
        return NextResponse.json(
          {
            error: "Database is missing memberships.payment_status",
            details: "Run db/migrations/20260307_memberships_payment_status.sql and redeploy.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to mark member paid", details: membershipUpdate.error.message },
        { status: 500 }
      );
    }

    const matchedMemberEmail = await loadMemberEmail(supabase, matchedUserId);
    const linkedOnboarding = await tryAutoLinkOnboarding({
      supabase,
      competitionId,
      season: payment.season,
      matchedUserId,
      matchedMemberEmail,
    });

    const paymentUpdate = await supabase
      .from("payment_records")
      .update({
        reconciliation_status: "matched",
        matched_user_id: matchedUserId,
        matched_onboarding_id: linkedOnboarding?.id ?? payment.matched_onboarding_id ?? null,
        matched_at_utc: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id)
      .eq("competition_id", competitionId);

    if (paymentUpdate.error) {
      return NextResponse.json(
        { error: "Payment matched, but ledger update failed", details: paymentUpdate.error.message },
        { status: 500 }
      );
    }

    const afterSnapshot = await loadMemberAuditSnapshot(supabase, competitionId, matchedUserId);
    const memberLabel =
      afterSnapshot.display_name ?? beforeSnapshot.display_name ?? shortUserLabel(matchedUserId);
    const changeSummary = describeMemberAuditChanges({
      before: beforeSnapshot,
      after: afterSnapshot,
    });

    const auditError = await recordAdminAuditEvent({
      competitionId,
      season: payment.season,
      actionType: "member_updated",
      actorMode: admin.mode,
      actorUserId: admin.mode === "bearer" ? admin.userId : null,
      targetType: "member",
      targetUserId: matchedUserId,
      targetLabel: memberLabel,
      summary: `Matched payment record to ${memberLabel}.${changeSummary.length ? ` ${changeSummary.join("; ")}.` : ""}`,
      requestPath: new URL(req.url).pathname,
      details: {
        payment_record_id: payment.id,
        amount_cents: payment.amount_cents,
        payment_method: payment.payment_method,
        matched_onboarding: linkedOnboarding,
        before: beforeSnapshot,
        after: afterSnapshot,
      },
    });
    if (auditError) {
      console.warn("admin audit log failed after payment match", auditError);
    }

    return NextResponse.json({
      ok: true,
      matched_user_id: matchedUserId,
      matched_onboarding: linkedOnboarding,
      member_payment_status: afterSnapshot.payment_status ?? "paid",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Unexpected error", details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
