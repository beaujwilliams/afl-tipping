import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";

const DEFAULT_SEASON = 2026;
const REMINDER_TYPE = "season_payment_pending_v1";
const DEFAULT_PAYMENT_INSTRUCTIONS =
  "Season entry is $30. Please send payment to +61 423 190 713.";

type MembershipRow = {
  user_id: string;
  payment_status: string | null;
};

type ExistingReminderRow = {
  user_id: string;
};

type ProfileWithEmailRow = {
  id: string;
  display_name: string | null;
  email: string | null;
};

type ProfileFallbackRow = {
  id: string;
  display_name: string | null;
};

type SendStatus = "sent" | "simulated" | "failed";

type SendResult = {
  status: SendStatus;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
};

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function normalizePaymentStatus(status: string | null | undefined) {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "paid" || s === "pending" || s === "waived") return s;
  return "pending";
}

function safeDisplayName(name: string | null | undefined, userId: string) {
  const n = String(name ?? "").trim();
  if (n) return n;
  return `${userId.slice(0, 8)}...`;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
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

async function sendPaymentReminderEmail(params: {
  apiKey: string;
  fromEmail: string;
  replyTo: string | null;
  toEmail: string;
  displayName: string;
  season: number;
  paymentInstructions: string;
  dryRun: boolean;
}): Promise<SendResult> {
  if (params.dryRun) {
    return {
      status: "simulated",
      provider: null,
      providerMessageId: null,
      error: null,
    };
  }

  const subject = `AFL Tipping Season ${params.season}: payment pending reminder`;

  const text = [
    `Hi ${params.displayName},`,
    "",
    `Our records show your payment status for Season ${params.season} is still pending.`,
    params.paymentInstructions,
    "",
    "If you have already paid, please reply to this email so we can update your status.",
    "",
    "Needlessly Complicated AFL Tipping",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.45; color: #111;">
      <p>Hi ${params.displayName},</p>
      <p>
        Our records show your payment status for <b>Season ${params.season}</b> is still pending.
      </p>
      <p>${params.paymentInstructions}</p>
      <p>If you have already paid, please reply to this email so we can update your status.</p>
      <p style="margin-top: 24px;">Needlessly Complicated AFL Tipping</p>
    </div>
  `;

  const payload: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
    reply_to?: string;
  } = {
    from: params.fromEmail,
    to: [params.toEmail],
    subject,
    text,
    html,
  };

  if (params.replyTo) payload.reply_to = params.replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();
  let bodyJson: unknown = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = null;
  }

  if (!res.ok) {
    const errHead = bodyText.slice(0, 300);
    return {
      status: "failed",
      provider: "resend",
      providerMessageId: null,
      error: `Resend error ${res.status}: ${errHead}`,
    };
  }

  const providerMessageId =
    typeof bodyJson === "object" &&
    bodyJson !== null &&
    "id" in bodyJson &&
    typeof (bodyJson as { id?: unknown }).id === "string"
      ? (bodyJson as { id: string }).id
      : null;

  return {
    status: "sent",
    provider: "resend",
    providerMessageId,
    error: null,
  };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || String(DEFAULT_SEASON));
    const dryRun = url.searchParams.get("dry_run") === "1";
    const force = url.searchParams.get("force") === "1";

    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    const resendApiKey = process.env.RESEND_API_KEY || "";
    const reminderFromEmail = process.env.REMINDER_FROM_EMAIL || "";
    const reminderReplyTo = process.env.REMINDER_REPLY_TO || null;
    const paymentInstructions =
      process.env.PAYMENT_REMINDER_INSTRUCTIONS?.trim() ||
      DEFAULT_PAYMENT_INSTRUCTIONS;

    if (!dryRun && (!resendApiKey || !reminderFromEmail)) {
      return NextResponse.json(
        {
          error: "Missing REMINDER_FROM_EMAIL or RESEND_API_KEY for email delivery",
          hint: "Set both env vars, or call with dry_run=1 for testing.",
        },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();
    const competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await resolveCompetitionIdForAdminRequest(req, supabase);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const tableCheck = await supabase
      .from("payment_reminder_emails")
      .select("id")
      .limit(1);

    if (tableCheck.error) {
      return NextResponse.json(
        {
          error: "payment_reminder_emails table missing or inaccessible",
          details: tableCheck.error.message,
          hint: "Apply migration db/migrations/20260311_payment_reminder_emails.sql",
        },
        { status: 500 }
      );
    }

    const memberships = await supabase
      .from("memberships")
      .select("user_id, payment_status")
      .eq("competition_id", competitionId);

    if (memberships.error) {
      if (
        isMissingColumnError(memberships.error.message, "payment_status")
      ) {
        return NextResponse.json(
          {
            error: "Database is missing memberships.payment_status",
            hint: "Apply migration db/migrations/20260307_memberships_payment_status.sql",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to read memberships", details: memberships.error.message },
        { status: 500 }
      );
    }

    const membershipRows = (memberships.data ?? []) as MembershipRow[];
    const pendingUserIds = membershipRows
      .filter((m) => normalizePaymentStatus(m.payment_status) === "pending")
      .map((m) => String(m.user_id));

    if (pendingUserIds.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        reminder_type: REMINDER_TYPE,
        dry_run: dryRun,
        force,
        pending_members: 0,
        recipients_targeted: 0,
        totals: { sent: 0, simulated: 0, failed: 0, no_email: 0, skipped_already_sent: 0 },
      });
    }

    let alreadySentSet = new Set<string>();
    if (!force) {
      const existing = await supabase
        .from("payment_reminder_emails")
        .select("user_id")
        .eq("competition_id", competitionId)
        .eq("season", season)
        .eq("reminder_type", REMINDER_TYPE)
        .eq("status", "sent")
        .in("user_id", pendingUserIds);

      if (existing.error) {
        return NextResponse.json(
          {
            error: "Failed to check existing payment reminders",
            details: existing.error.message,
          },
          { status: 500 }
        );
      }

      alreadySentSet = new Set<string>(
        ((existing.data ?? []) as ExistingReminderRow[]).map((x) => String(x.user_id))
      );
    }

    const targetUserIds = force
      ? pendingUserIds
      : pendingUserIds.filter((u) => !alreadySentSet.has(u));

    if (targetUserIds.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        reminder_type: REMINDER_TYPE,
        dry_run: dryRun,
        force,
        pending_members: pendingUserIds.length,
        recipients_targeted: 0,
        totals: {
          sent: 0,
          simulated: 0,
          failed: 0,
          no_email: 0,
          skipped_already_sent: pendingUserIds.length,
        },
      });
    }

    const nameByUserId = new Map<string, string>();
    const emailByUserId = new Map<string, string>();

    const profWithEmail = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", targetUserIds);

    if (!profWithEmail.error) {
      (profWithEmail.data as ProfileWithEmailRow[] | null)?.forEach((p) => {
        const userId = String(p.id);
        nameByUserId.set(userId, safeDisplayName(p.display_name, userId));
        const email = String(p.email ?? "").trim();
        if (email) emailByUserId.set(userId, email);
      });
    } else {
      const profFallback = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", targetUserIds);

      if (profFallback.error) {
        return NextResponse.json(
          { error: "Failed to read profiles", details: profFallback.error.message },
          { status: 500 }
        );
      }

      (profFallback.data as ProfileFallbackRow[] | null)?.forEach((p) => {
        const userId = String(p.id);
        nameByUserId.set(userId, safeDisplayName(p.display_name, userId));
      });
    }

    const unresolvedEmailUserIds = targetUserIds.filter((u) => !emailByUserId.has(u));
    if (unresolvedEmailUserIds.length > 0) {
      const fetchedEmails = await mapLimit(unresolvedEmailUserIds, 5, async (userId) => {
        const email = await getAuthEmailByUserId(userId);
        return { userId, email };
      });

      fetchedEmails.forEach(({ userId, email }) => {
        if (email) emailByUserId.set(userId, email);
      });
    }

    let sent = 0;
    let simulated = 0;
    let failed = 0;
    let noEmail = 0;

    const results: Array<{
      user_id: string;
      email: string | null;
      status: SendStatus | "no_email";
      error?: string | null;
    }> = [];

    for (const userId of targetUserIds) {
      const toEmail = emailByUserId.get(userId) ?? null;
      const displayName = nameByUserId.get(userId) ?? safeDisplayName(null, userId);

      if (!toEmail) {
        noEmail += 1;
        results.push({
          user_id: userId,
          email: null,
          status: "no_email",
          error: "No email on profile/auth user",
        });
        continue;
      }

      const sendResult = await sendPaymentReminderEmail({
        apiKey: resendApiKey,
        fromEmail: reminderFromEmail,
        replyTo: reminderReplyTo,
        toEmail,
        displayName,
        season,
        paymentInstructions,
        dryRun,
      });

      if (!dryRun) {
        const logUpsert = await supabase
          .from("payment_reminder_emails")
          .upsert(
            {
              competition_id: competitionId,
              season,
              user_id: userId,
              email: toEmail,
              reminder_type: REMINDER_TYPE,
              status: sendResult.status,
              provider: sendResult.provider,
              provider_message_id: sendResult.providerMessageId,
              error: sendResult.error,
              sent_at_utc: new Date().toISOString(),
            },
            { onConflict: "competition_id,season,user_id,reminder_type" }
          );

        if (logUpsert.error) {
          results.push({
            user_id: userId,
            email: toEmail,
            status: "failed",
            error: `Sent but failed logging: ${logUpsert.error.message}`,
          });
          failed += 1;
          if (sendResult.status === "sent") {
            sent = Math.max(0, sent - 1);
          } else if (sendResult.status === "simulated") {
            simulated = Math.max(0, simulated - 1);
          }
          continue;
        }
      }

      if (sendResult.status === "sent") sent += 1;
      else if (sendResult.status === "simulated") simulated += 1;
      else failed += 1;

      results.push({
        user_id: userId,
        email: toEmail,
        status: sendResult.status,
        error: sendResult.error,
      });
    }

    return NextResponse.json({
      ok: true,
      season,
      reminder_type: REMINDER_TYPE,
      dry_run: dryRun,
      force,
      payment_instructions: paymentInstructions,
      pending_members: pendingUserIds.length,
      recipients_targeted: targetUserIds.length,
      totals: {
        sent,
        simulated,
        failed,
        no_email: noEmail,
        skipped_already_sent: force ? 0 : pendingUserIds.length - targetUserIds.length,
      },
      results,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
