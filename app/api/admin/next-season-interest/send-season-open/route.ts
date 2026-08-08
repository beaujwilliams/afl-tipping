import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import {
  buildSeasonOpenSignupUrl,
  MIN_SEND_SPACING_MS,
  normalizeSeasonOpenRecipientName,
  sendSeasonOpenEmail,
  type SeasonOpenSendStatus,
} from "@/lib/next-season-invite-email";
import { NEXT_SEASON } from "@/lib/season-config";

type InterestStatus = "pending" | "notified" | "unsubscribed";

type InterestRecipientRow = {
  id: string;
  target_season: number;
  email: string | null;
  full_name: string | null;
  status: InterestStatus;
};

function parseSeason(raw: unknown, fallback: number) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return fallback;
  return Math.trunc(parsed);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
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
    const signupUrl = buildSeasonOpenSignupUrl();

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
      .not("email", "is", null)
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
      status: SeasonOpenSendStatus;
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
        displayName: normalizeSeasonOpenRecipientName(recipient.full_name, email),
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
