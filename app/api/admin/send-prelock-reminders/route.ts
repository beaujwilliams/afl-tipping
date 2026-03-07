import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";

const FALLBACK_ADMIN_EMAIL = "beau.j.williams@gmail.com";
const DEFAULT_SEASON = 2026;
const DEFAULT_REMINDER_HOURS = 3;
const DEFAULT_WINDOW_MINUTES = 30;
const REMINDER_TYPE = "missing_tips_3h";

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

type MatchRow = {
  id: string;
};

type MembershipRow = {
  user_id: string;
};

type TipRow = {
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

type ExistingReminderRow = {
  user_id: string;
};

type SendStatus = "sent" | "simulated" | "failed";

type SendResult = {
  status: SendStatus;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
};

type RoundResult = {
  round: number;
  lock_time_utc: string;
  total_members: number;
  missing_tip_members: number;
  already_reminded: number;
  candidates: number;
  no_email: number;
  sent: number;
  simulated: number;
  failed: number;
  skipped_no_matches: boolean;
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function safeDisplayName(name: string | null | undefined, userId: string) {
  const n = String(name ?? "").trim();
  if (n) return n;
  return `${userId.slice(0, 8)}...`;
}

function formatMelbourne(isoUtc: string) {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return isoUtc;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
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

async function allowBearerOrCron(req: Request): Promise<{
  ok: boolean;
  mode?: "cron" | "bearer";
  token?: string;
  secret?: string;
}> {
  const url = new URL(req.url);

  const secret = url.searchParams.get("secret") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && secret && secret === cronSecret) {
    return { ok: true, mode: "cron", secret };
  }

  const token = getBearer(req);
  if (!token) return { ok: false };

  const authClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data } = await authClient.auth.getUser(token);
  const email = (data.user?.email ?? "").toLowerCase();
  const adminEmail = (process.env.ADMIN_EMAIL || FALLBACK_ADMIN_EMAIL).toLowerCase();

  if (email !== adminEmail) return { ok: false };

  return { ok: true, mode: "bearer", token };
}

async function sendReminderEmail(params: {
  apiKey: string;
  fromEmail: string;
  replyTo: string | null;
  toEmail: string;
  displayName: string;
  season: number;
  roundNumber: number;
  lockTimeUtc: string;
  roundUrl: string;
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

  const lockMelbourne = formatMelbourne(params.lockTimeUtc);
  const subject = `AFL Tipping reminder: Round ${params.roundNumber} locks in about 3 hours`;

  const text = [
    `Hi ${params.displayName},`,
    "",
    `Round ${params.roundNumber} (Season ${params.season}) is locking soon.`,
    `Lock time: ${lockMelbourne} (Melbourne time)`,
    "",
    "You still have missing tips for this round.",
    `Submit now: ${params.roundUrl}`,
    "",
    "Needlessly Complicated AFL Tipping",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.45; color: #111;">
      <p>Hi ${params.displayName},</p>
      <p>
        <b>Round ${params.roundNumber}</b> (Season ${params.season}) is locking soon.<br />
        Lock time: <b>${lockMelbourne}</b> (Melbourne time)
      </p>
      <p>You still have missing tips for this round.</p>
      <p><a href="${params.roundUrl}">Submit tips now</a></p>
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
      ? ((bodyJson as { id: string }).id)
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
    const gate = await allowBearerOrCron(req);
    if (!gate.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || String(DEFAULT_SEASON));
    const roundParam = url.searchParams.get("round");
    const round = roundParam === null ? null : Number(roundParam);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const forceRound =
      url.searchParams.get("force") === "1" && round !== null && Number.isFinite(round);

    const reminderHours = Number(
      url.searchParams.get("hours_before_lock") || String(DEFAULT_REMINDER_HOURS)
    );
    const windowMinutes = Number(
      url.searchParams.get("window_minutes") || String(DEFAULT_WINDOW_MINUTES)
    );

    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      return NextResponse.json(
        { error: "Provide a valid season" },
        { status: 400 }
      );
    }

    if (round !== null && (!Number.isFinite(round) || round < 0)) {
      return NextResponse.json(
        { error: "Provide a valid round" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(reminderHours) || reminderHours <= 0) {
      return NextResponse.json(
        { error: "hours_before_lock must be a positive number" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(windowMinutes) || windowMinutes < 0) {
      return NextResponse.json(
        { error: "window_minutes must be zero or positive" },
        { status: 400 }
      );
    }

    const resendApiKey = process.env.RESEND_API_KEY || "";
    const reminderFromEmail = process.env.REMINDER_FROM_EMAIL || "";
    const reminderReplyTo = process.env.REMINDER_REPLY_TO || null;

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

    // Fail fast if migration is missing.
    const tableCheck = await supabase
      .from("prelock_reminder_emails")
      .select("id")
      .limit(1);

    if (tableCheck.error) {
      return NextResponse.json(
        {
          error: "prelock_reminder_emails table missing or inaccessible",
          details: tableCheck.error.message,
          hint: "Apply migration db/migrations/20260307_prelock_reminder_emails.sql",
        },
        { status: 500 }
      );
    }

    const { data: comp, error: cErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (cErr || !comp?.id) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    let roundsQuery = supabase
      .from("rounds")
      .select("id, round_number, lock_time_utc")
      .eq("competition_id", comp.id)
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (round !== null) {
      roundsQuery = roundsQuery.eq("round_number", round);
    }

    const { data: rounds, error: rErr } = await roundsQuery;
    if (rErr) {
      return NextResponse.json(
        { error: "Failed to load rounds", details: rErr.message },
        { status: 500 }
      );
    }

    const roundRows = (rounds ?? []) as RoundRow[];
    if (roundRows.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        rounds_considered: 0,
        rounds_targeted: 0,
        results: [],
      });
    }

    const nowMs = Date.now();
    const targetMs = reminderHours * 60 * 60 * 1000;
    const windowMs = windowMinutes * 60 * 1000;
    const windowStartMs = nowMs + targetMs - windowMs;
    const windowEndMs = nowMs + targetMs + windowMs;

    const targetedRounds: RoundRow[] = [];
    const skippedNotDue: number[] = [];
    const skippedInvalidLock: number[] = [];

    for (const r of roundRows) {
      const lockMs = r.lock_time_utc ? new Date(r.lock_time_utc).getTime() : NaN;
      if (!Number.isFinite(lockMs)) {
        skippedInvalidLock.push(r.round_number);
        continue;
      }

      if (forceRound) {
        targetedRounds.push(r);
        continue;
      }

      if (lockMs >= windowStartMs && lockMs <= windowEndMs) {
        targetedRounds.push(r);
        continue;
      }

      skippedNotDue.push(r.round_number);
    }

    const results: RoundResult[] = [];
    const roundErrors: Array<{ round: number; error: string }> = [];

    let totalSent = 0;
    let totalSimulated = 0;
    let totalFailed = 0;
    let totalNoEmail = 0;

    for (const r of targetedRounds) {
      if (!r.lock_time_utc) {
        roundErrors.push({ round: r.round_number, error: "Missing lock_time_utc" });
        continue;
      }

      const { data: matches, error: mErr } = await supabase
        .from("matches")
        .select("id")
        .eq("round_id", r.id);

      if (mErr) {
        roundErrors.push({ round: r.round_number, error: `Failed to load matches: ${mErr.message}` });
        continue;
      }

      const matchRows = (matches ?? []) as MatchRow[];
      const matchIds = matchRows.map((m) => String(m.id));

      if (matchIds.length === 0) {
        results.push({
          round: r.round_number,
          lock_time_utc: r.lock_time_utc,
          total_members: 0,
          missing_tip_members: 0,
          already_reminded: 0,
          candidates: 0,
          no_email: 0,
          sent: 0,
          simulated: 0,
          failed: 0,
          skipped_no_matches: true,
        });
        continue;
      }

      const { data: memberships, error: memErr } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("competition_id", comp.id);

      if (memErr) {
        roundErrors.push({
          round: r.round_number,
          error: `Failed to load memberships: ${memErr.message}`,
        });
        continue;
      }

      const memberRows = (memberships ?? []) as MembershipRow[];
      const memberIds = memberRows.map((m) => String(m.user_id));
      const memberSet = new Set(memberIds);

      if (memberIds.length === 0) {
        results.push({
          round: r.round_number,
          lock_time_utc: r.lock_time_utc,
          total_members: 0,
          missing_tip_members: 0,
          already_reminded: 0,
          candidates: 0,
          no_email: 0,
          sent: 0,
          simulated: 0,
          failed: 0,
          skipped_no_matches: false,
        });
        continue;
      }

      const { data: tips, error: tErr } = await supabase
        .from("tips")
        .select("user_id")
        .eq("competition_id", comp.id)
        .in("match_id", matchIds);

      if (tErr) {
        roundErrors.push({ round: r.round_number, error: `Failed to load tips: ${tErr.message}` });
        continue;
      }

      const tippedSet = new Set<string>();
      (tips as TipRow[] | null)?.forEach((t) => {
        const userId = String(t.user_id);
        if (memberSet.has(userId)) tippedSet.add(userId);
      });

      const missingMemberIds = memberIds.filter((userId) => !tippedSet.has(userId));

      if (missingMemberIds.length === 0) {
        results.push({
          round: r.round_number,
          lock_time_utc: r.lock_time_utc,
          total_members: memberIds.length,
          missing_tip_members: 0,
          already_reminded: 0,
          candidates: 0,
          no_email: 0,
          sent: 0,
          simulated: 0,
          failed: 0,
          skipped_no_matches: false,
        });
        continue;
      }

      const { data: existing, error: exErr } = await supabase
        .from("prelock_reminder_emails")
        .select("user_id")
        .eq("competition_id", comp.id)
        .eq("round_id", r.id)
        .eq("reminder_type", REMINDER_TYPE)
        .in("user_id", missingMemberIds)
        .eq("status", "sent");

      if (exErr) {
        roundErrors.push({
          round: r.round_number,
          error: `Failed to load reminder logs: ${exErr.message}`,
        });
        continue;
      }

      const alreadyRemindedSet = new Set<string>(
        ((existing ?? []) as ExistingReminderRow[]).map((x) => String(x.user_id))
      );

      const candidateUserIds = missingMemberIds.filter((u) => !alreadyRemindedSet.has(u));

      if (candidateUserIds.length === 0) {
        results.push({
          round: r.round_number,
          lock_time_utc: r.lock_time_utc,
          total_members: memberIds.length,
          missing_tip_members: missingMemberIds.length,
          already_reminded: missingMemberIds.length,
          candidates: 0,
          no_email: 0,
          sent: 0,
          simulated: 0,
          failed: 0,
          skipped_no_matches: false,
        });
        continue;
      }

      const nameByUserId = new Map<string, string>();
      const emailByUserId = new Map<string, string>();

      const profWithEmail = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", candidateUserIds);

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
          .in("id", candidateUserIds);

        if (profFallback.error) {
          roundErrors.push({
            round: r.round_number,
            error: `Failed to load profiles: ${profFallback.error.message}`,
          });
          continue;
        }

        (profFallback.data as ProfileFallbackRow[] | null)?.forEach((p) => {
          const userId = String(p.id);
          nameByUserId.set(userId, safeDisplayName(p.display_name, userId));
        });
      }

      const unresolvedEmailUserIds = candidateUserIds.filter((u) => !emailByUserId.has(u));
      if (unresolvedEmailUserIds.length > 0) {
        const fetchedEmails = await mapLimit(unresolvedEmailUserIds, 5, async (userId) => {
          const email = await getAuthEmailByUserId(userId);
          return { userId, email };
        });

        fetchedEmails.forEach(({ userId, email }) => {
          if (email) emailByUserId.set(userId, email);
        });
      }

      let noEmail = 0;
      let sent = 0;
      let simulated = 0;
      let failed = 0;

      for (const userId of candidateUserIds) {
        const toEmail = emailByUserId.get(userId);
        if (!toEmail) {
          noEmail += 1;
          totalNoEmail += 1;
          continue;
        }

        const displayName = nameByUserId.get(userId) ?? safeDisplayName(null, userId);
        const roundUrl = `${url.origin}/round/${season}/${r.round_number}`;

        const sendResult = await sendReminderEmail({
          apiKey: resendApiKey,
          fromEmail: reminderFromEmail,
          replyTo: reminderReplyTo,
          toEmail,
          displayName,
          season,
          roundNumber: r.round_number,
          lockTimeUtc: r.lock_time_utc,
          roundUrl,
          dryRun,
        });

        if (!dryRun) {
          const { error: insErr } = await supabase
            .from("prelock_reminder_emails")
            .insert({
              competition_id: comp.id,
              round_id: r.id,
              season,
              round_number: r.round_number,
              user_id: userId,
              email: toEmail,
              reminder_type: REMINDER_TYPE,
              lock_time_utc: r.lock_time_utc,
              status: sendResult.status,
              provider: sendResult.provider,
              provider_message_id: sendResult.providerMessageId,
              error: sendResult.error,
              sent_at_utc: new Date().toISOString(),
            });

          if (insErr && insErr.code !== "23505") {
            roundErrors.push({
              round: r.round_number,
              error: `Failed to insert reminder log for ${toEmail}: ${insErr.message}`,
            });
          }
        }

        if (sendResult.status === "sent") {
          sent += 1;
          totalSent += 1;
        } else if (sendResult.status === "simulated") {
          simulated += 1;
          totalSimulated += 1;
        } else {
          failed += 1;
          totalFailed += 1;
        }
      }

      results.push({
        round: r.round_number,
        lock_time_utc: r.lock_time_utc,
        total_members: memberIds.length,
        missing_tip_members: missingMemberIds.length,
        already_reminded: alreadyRemindedSet.size,
        candidates: candidateUserIds.length,
        no_email: noEmail,
        sent,
        simulated,
        failed,
        skipped_no_matches: false,
      });
    }

    return NextResponse.json({
      ok: roundErrors.length === 0,
      season,
      reminder_type: REMINDER_TYPE,
      reminder_hours_before_lock: reminderHours,
      reminder_window_minutes: windowMinutes,
      dry_run: dryRun,
      force_round: forceRound,
      rounds_considered: roundRows.length,
      rounds_targeted: targetedRounds.length,
      skipped_not_due_rounds: skippedNotDue,
      skipped_invalid_lock_rounds: skippedInvalidLock,
      totals: {
        sent: totalSent,
        simulated: totalSimulated,
        failed: totalFailed,
        no_email: totalNoEmail,
      },
      results,
      errors: roundErrors,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
