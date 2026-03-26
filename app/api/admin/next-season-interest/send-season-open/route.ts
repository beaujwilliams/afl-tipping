import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import { NEXT_SEASON } from "@/lib/season-config";

const RESEND_RATE_LIMIT_RETRY_ATTEMPTS = 3;
const MIN_SEND_SPACING_MS = 1100;

type InterestStatus = "pending" | "notified" | "unsubscribed";
type SendStatus = "sent" | "simulated" | "failed";

type InterestRecipientRow = {
  id: string;
  target_season: number;
  email: string;
  full_name: string | null;
  status: InterestStatus;
};

type SendResult = {
  status: SendStatus;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
};

function parseSeason(raw: unknown, fallback: number) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return fallback;
  return Math.trunc(parsed);
}

function normalizeName(name: string | null | undefined, email: string) {
  const trimmed = String(name ?? "").trim();
  if (trimmed) return trimmed;
  return email.split("@")[0] || "there";
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function getRetryDelayMsFromHeaders(headers: Headers, attempt: number) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      const delta = dateMs - Date.now();
      if (delta > 0) return delta;
    }
  }

  const resetRaw = headers.get("x-ratelimit-reset") ?? headers.get("ratelimit-reset");
  if (resetRaw) {
    const reset = Number(resetRaw);
    if (Number.isFinite(reset) && reset > 0) {
      const resetMs = reset > 1_000_000_000_000 ? reset : reset * 1000;
      const delta = Math.ceil(resetMs - Date.now());
      if (delta > 0) return delta;
    }
  }

  return Math.min(4000, 500 * 2 ** Math.max(0, attempt - 1));
}

async function sendSeasonOpenEmail(params: {
  apiKey: string;
  fromEmail: string;
  replyTo: string | null;
  toEmail: string;
  displayName: string;
  season: number;
  signupUrl: string;
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

  const subject = `AFL Tipping Season ${params.season}: signups are now open`;
  const text = [
    `Hi ${params.displayName},`,
    "",
    `Great news — signups for AFL Tipping Season ${params.season} are now open.`,
    `Create your account here: ${params.signupUrl}`,
    "",
    "Needlessly Complicated AFL Tipping",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.45; color: #111;">
      <p>Hi ${params.displayName},</p>
      <p><b>Great news</b> — signups for AFL Tipping Season ${params.season} are now open.</p>
      <p><a href="${params.signupUrl}">Create your account</a></p>
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

  for (let attempt = 1; attempt <= RESEND_RATE_LIMIT_RETRY_ATTEMPTS; attempt += 1) {
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

    if (res.ok) {
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

    const errHead = bodyText.slice(0, 300);
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < RESEND_RATE_LIMIT_RETRY_ATTEMPTS) {
      const delayMs = getRetryDelayMsFromHeaders(res.headers, attempt);
      await sleep(delayMs);
      continue;
    }

    return {
      status: "failed",
      provider: "resend",
      providerMessageId: null,
      error: `Resend error ${res.status}: ${errHead}`,
    };
  }

  return {
    status: "failed",
    provider: "resend",
    providerMessageId: null,
    error: "Resend error: retry attempts exhausted",
  };
}

export async function POST(req: Request) {
  try {
    const supabase = createServiceClient();
    const competitionId = await resolveCompetitionIdForAdminRequest(req, supabase);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const gate = await requireAdminOrCron(req, { competitionId });
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const body = (await req.json().catch(() => null)) as
      | null
      | {
          season?: number;
          dry_run?: boolean;
          force?: boolean;
        };

    const season = parseSeason(body?.season, NEXT_SEASON);
    const dryRun = body?.dry_run === true;
    const force = body?.force === true;

    const resendApiKey = process.env.RESEND_API_KEY || "";
    const reminderFromEmail = process.env.REMINDER_FROM_EMAIL || "";
    const reminderReplyTo = process.env.REMINDER_REPLY_TO || null;
    const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || "https://www.complicatedtips.com").replace(/\/+$/, "");
    const signupUrl = `${siteUrl}/signup`;

    if (!dryRun && (!resendApiKey || !reminderFromEmail)) {
      return NextResponse.json(
        {
          error: "Missing REMINDER_FROM_EMAIL or RESEND_API_KEY for email delivery",
          hint: "Set both env vars, or call with dry_run=true for testing.",
        },
        { status: 500 }
      );
    }

    const allowedStatuses: InterestStatus[] = force ? ["pending", "notified"] : ["pending"];
    const recipientsQuery = await supabase
      .from("next_season_interest")
      .select("id,target_season,email,full_name,status")
      .eq("target_season", season)
      .in("status", allowedStatuses)
      .order("submitted_at_utc", { ascending: true });

    if (recipientsQuery.error) {
      return NextResponse.json(
        { error: "Failed to read interested members", details: recipientsQuery.error.message },
        { status: 500 }
      );
    }

    const recipients = (recipientsQuery.data ?? []) as InterestRecipientRow[];
    if (recipients.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        dry_run: dryRun,
        force,
        recipients_targeted: 0,
        totals: { sent: 0, simulated: 0, failed: 0 },
        results: [],
      });
    }

    let sent = 0;
    let simulated = 0;
    let failed = 0;
    let lastSendAttemptAtMs = 0;

    const results: Array<{
      id: string;
      email: string;
      status: SendStatus;
      error: string | null;
      provider_message_id: string | null;
    }> = [];

    for (const recipient of recipients) {
      const email = String(recipient.email ?? "").trim();
      if (!email) {
        failed += 1;
        results.push({
          id: recipient.id,
          email: "",
          status: "failed",
          error: "Missing email",
          provider_message_id: null,
        });
        continue;
      }

      if (!dryRun && lastSendAttemptAtMs > 0) {
        const elapsed = Date.now() - lastSendAttemptAtMs;
        if (elapsed < MIN_SEND_SPACING_MS) {
          await sleep(MIN_SEND_SPACING_MS - elapsed);
        }
      }
      lastSendAttemptAtMs = Date.now();

      const sendResult = await sendSeasonOpenEmail({
        apiKey: resendApiKey,
        fromEmail: reminderFromEmail,
        replyTo: reminderReplyTo,
        toEmail: email,
        displayName: normalizeName(recipient.full_name, email),
        season,
        signupUrl,
        dryRun,
      });

      if (sendResult.status === "sent") {
        sent += 1;
      } else if (sendResult.status === "simulated") {
        simulated += 1;
      } else {
        failed += 1;
      }

      if (!dryRun && sendResult.status === "sent") {
        const update = await supabase
          .from("next_season_interest")
          .update({
            status: "notified",
            updated_at: new Date().toISOString(),
          })
          .eq("id", recipient.id);

        if (update.error) {
          failed += 1;
          sent = Math.max(0, sent - 1);
          results.push({
            id: recipient.id,
            email,
            status: "failed",
            error: `Sent but failed update: ${update.error.message}`,
            provider_message_id: sendResult.providerMessageId,
          });
          continue;
        }
      }

      results.push({
        id: recipient.id,
        email,
        status: sendResult.status,
        error: sendResult.error,
        provider_message_id: sendResult.providerMessageId,
      });
    }

    return NextResponse.json({
      ok: true,
      season,
      dry_run: dryRun,
      force,
      signup_url: signupUrl,
      recipients_targeted: recipients.length,
      totals: {
        sent,
        simulated,
        failed,
      },
      results,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
