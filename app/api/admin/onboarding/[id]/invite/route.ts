import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import {
  buildSeasonOpenSignupUrl,
  normalizeSeasonOpenRecipientName,
  sendSeasonOpenEmail,
} from "@/lib/next-season-invite-email";

type InterestStatus = "pending" | "notified" | "unsubscribed";

type InterestRow = {
  id: string;
  target_season: number;
  email: string;
  full_name: string | null;
  status: InterestStatus;
  pipeline_stage?: string | null;
  invited_at_utc?: string | null;
  archived_at_utc?: string | null;
  linked_user_id?: string | null;
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

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServiceClient();
    const competitionId = await resolveCompetitionIdForAdminRequest(req, supabase);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const gate = await requireAdminOrCron(req, { competitionId });
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const params = await context.params;
    const id = String(params.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Invite row id is required" }, { status: 400 });
    }

    const resendApiKey = process.env.RESEND_API_KEY || "";
    const reminderFromEmail = process.env.REMINDER_FROM_EMAIL || "";
    const reminderReplyTo = process.env.REMINDER_REPLY_TO || null;
    const signupUrl = buildSeasonOpenSignupUrl();

    if (!resendApiKey || !reminderFromEmail) {
      return NextResponse.json(
        {
          error: "Missing REMINDER_FROM_EMAIL or RESEND_API_KEY for email delivery",
          hint: "Set both env vars before sending season-open invites.",
        },
        { status: 500 }
      );
    }

    const rowResult = await supabase
      .from("next_season_interest")
      .select("id,target_season,email,full_name,status,pipeline_stage,invited_at_utc,archived_at_utc,linked_user_id")
      .eq("id", id)
      .maybeSingle();

    if (rowResult.error) {
      if (isMissingRelationError(rowResult.error.message, "next_season_interest")) {
        return NextResponse.json(
          {
            error: "Database is missing next_season_interest table",
            details: "Run db/migrations/20260326_next_season_interest.sql and redeploy.",
          },
          { status: 500 }
        );
      }
      if (isMissingColumnError(rowResult.error.message, "pipeline_stage")) {
        return NextResponse.json(
          {
            error: "Database is missing onboarding fields",
            details: "Run db/migrations/20260409_next_season_interest_onboarding.sql and redeploy.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to load onboarding row", details: rowResult.error.message },
        { status: 500 }
      );
    }

    const row = (rowResult.data as InterestRow | null) ?? null;
    if (!row) {
      return NextResponse.json({ error: "Onboarding row not found" }, { status: 404 });
    }

    if (String(row.linked_user_id ?? "").trim()) {
      return NextResponse.json(
        { error: "This person is already linked to a member. No invite email is needed." },
        { status: 409 }
      );
    }

    const stage = String(row.pipeline_stage ?? "").trim().toLowerCase();
    if (row.status === "unsubscribed" || stage === "archived" || row.archived_at_utc) {
      return NextResponse.json(
        { error: "Archived or unsubscribed rows cannot be invited. Restore the row first." },
        { status: 409 }
      );
    }

    const email = String(row.email ?? "").trim();
    if (!email) {
      return NextResponse.json({ error: "This onboarding row has no email address" }, { status: 400 });
    }

    const sendResult = await sendSeasonOpenEmail({
      apiKey: resendApiKey,
      fromEmail: reminderFromEmail,
      replyTo: reminderReplyTo,
      toEmail: email,
      displayName: normalizeSeasonOpenRecipientName(row.full_name, email),
      season: Number(row.target_season ?? 0),
      signupUrl,
      dryRun: false,
    });

    if (sendResult.status !== "sent") {
      return NextResponse.json(
        {
          error: "Failed to send invite",
          details: sendResult.error ?? "Unknown email delivery error",
        },
        { status: 500 }
      );
    }

    const nowIso = new Date().toISOString();
    const update = await supabase
      .from("next_season_interest")
      .update({
        status: "notified",
        pipeline_stage: "invited",
        invited_at_utc: row.invited_at_utc ?? nowIso,
        updated_at: nowIso,
      })
      .eq("id", id)
      .select("id,target_season,email,full_name,status,pipeline_stage,invited_at_utc,linked_user_id")
      .maybeSingle();

    if (update.error) {
      return NextResponse.json(
        {
          error: "Invite sent but failed to update onboarding row",
          details: update.error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      row: update.data ?? null,
      invite_status: sendResult.status,
      provider_message_id: sendResult.providerMessageId,
      signup_url: signupUrl,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "Unexpected error", details }, { status: 500 });
  }
}
