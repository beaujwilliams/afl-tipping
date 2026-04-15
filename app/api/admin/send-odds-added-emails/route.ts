import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";

const DEFAULT_SEASON = 2026;
const NOTIFICATION_TYPE = "odds_snapshot_set_v1";
const BOOKMAKER_KEY = "sportsbet";
const MARKET_KEY = "h2h";
const RESEND_RATE_LIMIT_RETRY_ATTEMPTS = 3;
const MIN_SEND_SPACING_MS = 1100;

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
  odds_snapshot_for_time_utc: string | null;
};

type MatchRow = {
  id: string;
  commence_time_utc: string | null;
  home_team: string;
  away_team: string;
};

type OddsRow = {
  match_id: string;
  home_odds: number | null;
  away_odds: number | null;
  captured_at_utc: string | null;
};

type MembershipRow = {
  user_id: string;
  is_test_account?: boolean | null;
};

type ExistingSentRow = {
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

type FixtureLine = {
  index: number;
  line: string;
};

function isLikelyEmail(value: string) {
  const email = value.trim();
  if (!email) return false;
  if (!email.includes("@")) return false;
  if (email.startsWith("@") || email.endsWith("@")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseEmailList(raw: string | null | undefined) {
  const input = String(raw ?? "").trim();
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(/[,\s;]+/g)) {
    const email = part.trim().toLowerCase();
    if (!isLikelyEmail(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function normalizeNameFromEmail(email: string) {
  const local = String(email.split("@")[0] ?? "").trim();
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "there";
  return cleaned
    .split(/\s+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isMissingColumnError(message: string, columnName: string) {
  const m = String(message ?? "").toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function formatMelbourne(isoUtc: string) {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return isoUtc;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatOdds(value: number | null | undefined) {
  const n = Number(value ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return "TBC";
  return `$${n.toFixed(2)}`;
}

function safeDisplayName(name: string | null | undefined, userId: string) {
  const n = String(name ?? "").trim();
  if (n) return n;
  return `${userId.slice(0, 8)}...`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

async function sendOddsAddedEmail(params: {
  apiKey: string;
  fromEmail: string;
  replyTo: string | null;
  toEmail: string;
  displayName: string;
  season: number;
  round: number;
  lockTimeUtc: string;
  roundUrl: string;
  fixtureLines: FixtureLine[];
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
  const subject = `Round ${params.round} odds are now set + lockout time`;
  const textLines = params.fixtureLines.map((row) => `${row.index}. ${row.line}`);
  const htmlRows = params.fixtureLines
    .map((row) => `<li>${escapeHtml(row.line)}</li>`)
    .join("");

  const text = [
    `Hi ${params.displayName},`,
    "",
    `Round ${params.round} odds have now been added and are locked in for this round.`,
    "",
    `Round ${params.round} lockout: ${lockMelbourne} (Melbourne time)`,
    "",
    `Submit your tips before lockout: ${params.roundUrl}`,
    "",
    `Round ${params.round} fixtures + odds`,
    ...textLines,
    "",
    "Needlessly Complicated AFL Tipping",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.45; color: #111;">
      <p>Hi ${escapeHtml(params.displayName)},</p>
      <p>Round <b>${params.round}</b> odds have now been added and are locked in for this round.</p>
      <p><b>Round ${params.round} lockout:</b> ${escapeHtml(lockMelbourne)} (Melbourne time)</p>
      <p>Submit your tips before lockout: <a href="${escapeHtml(params.roundUrl)}">${escapeHtml(
        params.roundUrl
      )}</a></p>
      <p><b>Round ${params.round} fixtures + odds</b></p>
      <ol style="margin: 0; padding-left: 20px;">${htmlRows}</ol>
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

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || String(DEFAULT_SEASON));
    const round = Number(url.searchParams.get("round") || "");
    const dryRun = url.searchParams.get("dry_run") === "1";
    const forceResend = url.searchParams.get("force_resend") === "1";
    const snapshotOverride = String(url.searchParams.get("snapshot_for_time_utc") || "").trim();
    const toEmailOverride = parseEmailList(url.searchParams.get("to_email"));
    const directTestMode = toEmailOverride.length > 0;

    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }
    if (!Number.isFinite(round) || round <= 0) {
      return NextResponse.json({ error: "Provide a valid round" }, { status: 400 });
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
    const competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await resolveCompetitionIdForAdminRequest(req, supabase);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const roundQuery = await supabase
      .from("rounds")
      .select("id, round_number, lock_time_utc, odds_snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .eq("round_number", round)
      .maybeSingle();

    if (roundQuery.error) {
      return NextResponse.json(
        { error: "Failed to load round", details: roundQuery.error.message },
        { status: 500 }
      );
    }

    const roundRow = (roundQuery.data ?? null) as RoundRow | null;
    if (!roundRow) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }
    if (!roundRow.lock_time_utc) {
      return NextResponse.json({ error: "Round lock_time_utc is missing" }, { status: 400 });
    }

    const snapshotForTimeUtc = snapshotOverride || String(roundRow.odds_snapshot_for_time_utc ?? "");
    if (!snapshotForTimeUtc) {
      return NextResponse.json(
        {
          error: "Round does not have odds_snapshot_for_time_utc yet",
          hint: "Run snapshot first, or pass snapshot_for_time_utc explicitly.",
        },
        { status: 400 }
      );
    }

    const matchesQuery = await supabase
      .from("matches")
      .select("id, commence_time_utc, home_team, away_team")
      .eq("round_id", roundRow.id)
      .order("commence_time_utc", { ascending: true });

    if (matchesQuery.error) {
      return NextResponse.json(
        { error: "Failed to load round matches", details: matchesQuery.error.message },
        { status: 500 }
      );
    }

    const matches = (matchesQuery.data ?? []) as MatchRow[];
    if (matches.length === 0) {
      return NextResponse.json({ error: "No matches found for round" }, { status: 404 });
    }

    const matchIds = matches.map((m) => String(m.id));
    const oddsQuery = await supabase
      .from("match_odds")
      .select("match_id, home_odds, away_odds, captured_at_utc")
      .eq("competition_id", competitionId)
      .eq("bookmaker_key", BOOKMAKER_KEY)
      .eq("market_key", MARKET_KEY)
      .eq("snapshot_for_time_utc", snapshotForTimeUtc)
      .in("match_id", matchIds);

    if (oddsQuery.error) {
      return NextResponse.json(
        { error: "Failed to load snapshot odds", details: oddsQuery.error.message },
        { status: 500 }
      );
    }

    const oddsRows = (oddsQuery.data ?? []) as OddsRow[];
    const oddsByMatchId = new Map<string, OddsRow>();
    oddsRows.forEach((row) => {
      oddsByMatchId.set(String(row.match_id), row);
    });

    if (oddsByMatchId.size === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No snapshot odds rows found for round",
          season,
          round,
          snapshot_for_time_utc: snapshotForTimeUtc,
        },
        { status: 409 }
      );
    }

    const fixtureLines: FixtureLine[] = matches.map((match, i) => {
      const odds = oddsByMatchId.get(String(match.id));
      const homeOdds = formatOdds(odds?.home_odds ?? null);
      const awayOdds = formatOdds(odds?.away_odds ?? null);
      return {
        index: i + 1,
        line: `${match.home_team} [${match.home_team} ${homeOdds}] vs ${match.away_team} [${match.away_team} ${awayOdds}]`,
      };
    });

    const missingOddsMatches = matches.filter((match) => !oddsByMatchId.has(String(match.id))).length;

    if (directTestMode) {
      let sent = 0;
      let simulated = 0;
      let failed = 0;
      let lastSendAttemptAtMs = 0;

      const results: Array<{
        email: string;
        status: SendStatus;
        error?: string | null;
      }> = [];

      for (const email of toEmailOverride) {
        if (!dryRun && lastSendAttemptAtMs > 0) {
          const elapsed = Date.now() - lastSendAttemptAtMs;
          if (elapsed < MIN_SEND_SPACING_MS) {
            await sleep(MIN_SEND_SPACING_MS - elapsed);
          }
        }
        lastSendAttemptAtMs = Date.now();

        const roundUrl = `${url.origin}/round/${season}/${round}`;
        const sendResult = await sendOddsAddedEmail({
          apiKey: resendApiKey,
          fromEmail: reminderFromEmail,
          replyTo: reminderReplyTo,
          toEmail: email,
          displayName: normalizeNameFromEmail(email),
          season,
          round,
          lockTimeUtc: roundRow.lock_time_utc,
          roundUrl,
          fixtureLines,
          dryRun,
        });

        if (sendResult.status === "sent") sent += 1;
        else if (sendResult.status === "simulated") simulated += 1;
        else failed += 1;

        results.push({
          email,
          status: sendResult.status,
          error: sendResult.error,
        });
      }

      return NextResponse.json({
        ok: true,
        season,
        round,
        competition_id: competitionId,
        direct_test_mode: true,
        notification_type: NOTIFICATION_TYPE,
        dry_run: dryRun,
        force_resend: forceResend,
        snapshot_for_time_utc: snapshotForTimeUtc,
        lock_time_utc: roundRow.lock_time_utc,
        lock_time_melbourne: formatMelbourne(roundRow.lock_time_utc),
        fixtures_total: fixtureLines.length,
        fixtures_missing_odds: missingOddsMatches,
        recipients_targeted: toEmailOverride.length,
        totals: {
          sent,
          simulated,
          failed,
          no_email: 0,
          skipped_already_sent: 0,
        },
        results,
        fixture_preview: fixtureLines,
      });
    }

    const tableCheck = await supabase
      .from("odds_snapshot_notification_emails")
      .select("id")
      .limit(1);
    if (tableCheck.error) {
      return NextResponse.json(
        {
          error: "odds_snapshot_notification_emails table missing or inaccessible",
          details: tableCheck.error.message,
          hint: "Apply migration db/migrations/20260415_odds_snapshot_notification_emails.sql",
        },
        { status: 500 }
      );
    }

    const withTestFlag = await supabase
      .from("memberships")
      .select("user_id, is_test_account")
      .eq("competition_id", competitionId);

    let membershipRows: MembershipRow[] = [];
    if (withTestFlag.error && isMissingColumnError(withTestFlag.error.message, "is_test_account")) {
      const fallback = await supabase
        .from("memberships")
        .select("user_id")
        .eq("competition_id", competitionId);
      if (fallback.error) {
        return NextResponse.json(
          { error: "Failed to read memberships", details: fallback.error.message },
          { status: 500 }
        );
      }
      membershipRows = (fallback.data ?? []) as unknown as MembershipRow[];
    } else if (withTestFlag.error) {
      return NextResponse.json(
        { error: "Failed to read memberships", details: withTestFlag.error.message },
        { status: 500 }
      );
    } else {
      membershipRows = (withTestFlag.data ?? []) as unknown as MembershipRow[];
    }

    const memberUserIds = membershipRows
      .filter((row) => !Boolean(row.is_test_account))
      .map((row) => String(row.user_id));

    if (memberUserIds.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        round,
        notification_type: NOTIFICATION_TYPE,
        dry_run: dryRun,
        force_resend: forceResend,
        snapshot_for_time_utc: snapshotForTimeUtc,
        lock_time_utc: roundRow.lock_time_utc,
        recipients_targeted: 0,
        totals: { sent: 0, simulated: 0, failed: 0, no_email: 0, skipped_already_sent: 0 },
      });
    }

    let alreadySentSet = new Set<string>();
    if (!forceResend) {
      const existing = await supabase
        .from("odds_snapshot_notification_emails")
        .select("user_id")
        .eq("competition_id", competitionId)
        .eq("round_id", roundRow.id)
        .eq("notification_type", NOTIFICATION_TYPE)
        .eq("snapshot_for_time_utc", snapshotForTimeUtc)
        .eq("status", "sent")
        .in("user_id", memberUserIds);

      if (existing.error) {
        return NextResponse.json(
          {
            error: "Failed to check existing odds notifications",
            details: existing.error.message,
          },
          { status: 500 }
        );
      }

      alreadySentSet = new Set<string>(
        ((existing.data ?? []) as ExistingSentRow[]).map((x) => String(x.user_id))
      );
    }

    const targetUserIds = forceResend
      ? memberUserIds
      : memberUserIds.filter((userId) => !alreadySentSet.has(userId));

    if (targetUserIds.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        round,
        notification_type: NOTIFICATION_TYPE,
        dry_run: dryRun,
        force_resend: forceResend,
        snapshot_for_time_utc: snapshotForTimeUtc,
        lock_time_utc: roundRow.lock_time_utc,
        fixtures_total: fixtureLines.length,
        fixtures_missing_odds: missingOddsMatches,
        recipients_targeted: 0,
        totals: {
          sent: 0,
          simulated: 0,
          failed: 0,
          no_email: 0,
          skipped_already_sent: memberUserIds.length,
        },
      });
    }

    const nameByUserId = new Map<string, string>();
    const emailByUserId = new Map<string, string>();

    const profileWithEmail = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", targetUserIds);

    if (!profileWithEmail.error) {
      (profileWithEmail.data as ProfileWithEmailRow[] | null)?.forEach((profile) => {
        const userId = String(profile.id);
        nameByUserId.set(userId, safeDisplayName(profile.display_name, userId));
        const email = String(profile.email ?? "").trim();
        if (email) emailByUserId.set(userId, email);
      });
    } else {
      const profileFallback = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", targetUserIds);

      if (profileFallback.error) {
        return NextResponse.json(
          { error: "Failed to read profiles", details: profileFallback.error.message },
          { status: 500 }
        );
      }

      (profileFallback.data as ProfileFallbackRow[] | null)?.forEach((profile) => {
        const userId = String(profile.id);
        nameByUserId.set(userId, safeDisplayName(profile.display_name, userId));
      });
    }

    const unresolvedEmailUserIds = targetUserIds.filter((userId) => !emailByUserId.has(userId));
    if (unresolvedEmailUserIds.length > 0) {
      const fetched = await mapLimit(unresolvedEmailUserIds, 5, async (userId) => {
        const email = await getAuthEmailByUserId(userId);
        return { userId, email };
      });

      fetched.forEach(({ userId, email }) => {
        if (email) emailByUserId.set(userId, email);
      });
    }

    let sent = 0;
    let simulated = 0;
    let failed = 0;
    let noEmail = 0;
    let lastSendAttemptAtMs = 0;

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

      if (!dryRun && lastSendAttemptAtMs > 0) {
        const elapsed = Date.now() - lastSendAttemptAtMs;
        if (elapsed < MIN_SEND_SPACING_MS) {
          await sleep(MIN_SEND_SPACING_MS - elapsed);
        }
      }
      lastSendAttemptAtMs = Date.now();

      const roundUrl = `${url.origin}/round/${season}/${round}`;
      const sendResult = await sendOddsAddedEmail({
        apiKey: resendApiKey,
        fromEmail: reminderFromEmail,
        replyTo: reminderReplyTo,
        toEmail,
        displayName,
        season,
        round,
        lockTimeUtc: roundRow.lock_time_utc,
        roundUrl,
        fixtureLines,
        dryRun,
      });

      if (!dryRun) {
        const logUpsert = await supabase
          .from("odds_snapshot_notification_emails")
          .upsert(
            {
              competition_id: competitionId,
              round_id: roundRow.id,
              season,
              round_number: round,
              user_id: userId,
              email: toEmail,
              notification_type: NOTIFICATION_TYPE,
              snapshot_for_time_utc: snapshotForTimeUtc,
              lock_time_utc: roundRow.lock_time_utc,
              status: sendResult.status,
              provider: sendResult.provider,
              provider_message_id: sendResult.providerMessageId,
              error: sendResult.error,
              sent_at_utc: new Date().toISOString(),
            },
            {
              onConflict:
                "competition_id,round_id,user_id,notification_type,snapshot_for_time_utc",
            }
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
      round,
      competition_id: competitionId,
      notification_type: NOTIFICATION_TYPE,
      dry_run: dryRun,
      force_resend: forceResend,
      snapshot_for_time_utc: snapshotForTimeUtc,
      lock_time_utc: roundRow.lock_time_utc,
      lock_time_melbourne: formatMelbourne(roundRow.lock_time_utc),
      fixtures_total: fixtureLines.length,
      fixtures_missing_odds: missingOddsMatches,
      recipients_targeted: targetUserIds.length,
      totals: {
        sent,
        simulated,
        failed,
        no_email: noEmail,
        skipped_already_sent: forceResend ? 0 : memberUserIds.length - targetUserIds.length,
      },
      results,
      fixture_preview: fixtureLines,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
