import { NextResponse } from "next/server";
import {
  requireAdminOrCron,
  resolveCompetitionIdForAdminRequest,
} from "@/lib/admin-auth";
import {
  ACTIVE_SCORING_FAILURE_ALERT_COOLDOWN_MINUTES_DEFAULT,
  ACTIVE_SCORING_FAILURE_ALERT_EMAIL_DEFAULT,
  ACTIVE_SCORING_FAILURE_ALERT_KEY,
  ACTIVE_SCORING_FAILURE_ALERT_THRESHOLD_DEFAULT,
  countLeadingFailedRuns,
  readBoundedInt,
  summarizeScoringFailureFromDetails,
} from "@/lib/scoring-automation-alerts";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type AdminCallResult = {
  status: number;
  json: Record<string, unknown>;
};

type ScoringRunStatus = "success" | "failed";

type ScoringRunInsertRow = {
  id: string;
};

type RecentActiveRunRow = {
  id: string;
  run_status: string;
  started_at_utc: string;
  details: unknown;
};

type AlertEventLookupRow = {
  id: string;
  sent_at_utc: string;
};

type ActiveFailureAlertResult = {
  evaluated: boolean;
  sent: boolean;
  recipient: string | null;
  consecutive_failures: number;
  threshold: number;
  cooldown_minutes: number;
  skipped_reason: string | null;
  error: string | null;
  alert_logged: boolean;
  alert_log_error: string | null;
};

const RESEND_RATE_LIMIT_RETRY_ATTEMPTS = 3;

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

async function sendAlertEmail(params: {
  apiKey: string;
  fromEmail: string;
  replyTo: string | null;
  toEmail: string;
  subject: string;
  text: string;
  html: string;
}) {
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
    subject: params.subject,
    text: params.text,
    html: params.html,
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
      return { ok: true, providerMessageId, error: null };
    }

    const errHead = bodyText.slice(0, 300);
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < RESEND_RATE_LIMIT_RETRY_ATTEMPTS) {
      await sleep(getRetryDelayMsFromHeaders(res.headers, attempt));
      continue;
    }

    return {
      ok: false,
      providerMessageId: null,
      error: `Resend error ${res.status}: ${errHead}`,
    };
  }

  return {
    ok: false,
    providerMessageId: null,
    error: "Resend error: retry attempts exhausted",
  };
}

async function maybeSendActiveFailureAlert(params: {
  supabase: ReturnType<typeof createServiceClient>;
  competitionId: string;
  season: number;
  origin: string;
  runStatus: ScoringRunStatus;
  jobKind: "scoring_15m" | "scoring_daily_full" | "manual";
  triggerMode: "cron" | "bearer";
  runId: string | null;
}) {
  const threshold = readBoundedInt(
    process.env.ACTIVE_SCORING_FAILURE_ALERT_THRESHOLD,
    ACTIVE_SCORING_FAILURE_ALERT_THRESHOLD_DEFAULT,
    2,
    12
  );
  const cooldownMinutes = readBoundedInt(
    process.env.ACTIVE_SCORING_FAILURE_ALERT_COOLDOWN_MINUTES,
    ACTIVE_SCORING_FAILURE_ALERT_COOLDOWN_MINUTES_DEFAULT,
    10,
    24 * 12
  );
  const recipient = String(
    process.env.ACTIVE_SCORING_FAILURE_ALERT_EMAIL ??
      ACTIVE_SCORING_FAILURE_ALERT_EMAIL_DEFAULT
  )
    .trim()
    .toLowerCase();

  const base: ActiveFailureAlertResult = {
    evaluated: false,
    sent: false,
    recipient: recipient || null,
    consecutive_failures: 0,
    threshold,
    cooldown_minutes: cooldownMinutes,
    skipped_reason: "not_applicable",
    error: null,
    alert_logged: false,
    alert_log_error: null,
  };

  if (params.jobKind !== "scoring_15m" || params.runStatus !== "failed") {
    return base;
  }

  base.evaluated = true;

  const recentRuns = await params.supabase
    .from("scoring_automation_runs")
    .select("id, run_status, started_at_utc, details")
    .eq("competition_id", params.competitionId)
    .eq("season", params.season)
    .eq("job_kind", "scoring_15m")
    .order("started_at_utc", { ascending: false })
    .limit(Math.max(12, threshold + 5));

  if (recentRuns.error) {
    base.skipped_reason = "load_recent_runs_failed";
    base.error = recentRuns.error.message;
    return base;
  }

  const recentRows = (recentRuns.data ?? []) as RecentActiveRunRow[];
  base.consecutive_failures = countLeadingFailedRuns(recentRows);

  if (base.consecutive_failures < threshold) {
    base.skipped_reason = "below_threshold";
    return base;
  }

  const cooldownCutoffUtc = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString();
  const recentAlert = await params.supabase
    .from("automation_alert_events")
    .select("id, sent_at_utc")
    .eq("competition_id", params.competitionId)
    .eq("season", params.season)
    .eq("alert_key", ACTIVE_SCORING_FAILURE_ALERT_KEY)
    .gte("sent_at_utc", cooldownCutoffUtc)
    .order("sent_at_utc", { ascending: false })
    .limit(1);

  if (recentAlert.error) {
    base.skipped_reason = "alert_state_unavailable";
    base.error = isMissingRelationError(recentAlert.error.message, "automation_alert_events")
      ? `${recentAlert.error.message} (hint: apply migration db/migrations/20260415_automation_alert_events.sql)`
      : recentAlert.error.message;
    return base;
  }

  if (((recentAlert.data ?? []) as AlertEventLookupRow[]).length > 0) {
    base.skipped_reason = "cooldown_active";
    return base;
  }

  const resendApiKey = process.env.RESEND_API_KEY || "";
  const fromEmail = process.env.REMINDER_FROM_EMAIL || "";
  const replyTo = process.env.REMINDER_REPLY_TO || null;
  if (!recipient || !resendApiKey || !fromEmail) {
    base.skipped_reason = "email_not_configured";
    base.error =
      "Missing ACTIVE_SCORING_FAILURE_ALERT_EMAIL recipient or REMINDER_FROM_EMAIL/RESEND_API_KEY.";
    return base;
  }

  const latestFailure = recentRows[0] ?? null;
  const latestFailureStartedAtUtc = latestFailure?.started_at_utc ?? new Date().toISOString();
  const failureSummary = summarizeScoringFailureFromDetails(latestFailure?.details);
  const scoringLogUrl = `${params.origin}/admin/scoring-sync?season=${encodeURIComponent(
    String(params.season)
  )}`;

  const subject = `AFL Tipping alert: active scoring check failing (${base.consecutive_failures} in a row)`;
  const text = [
    "Automated alert from Needlessly Complicated AFL Tipping.",
    "",
    `Season: ${params.season}`,
    `Competition ID: ${params.competitionId}`,
    `Trigger mode: ${params.triggerMode}`,
    `Consecutive active-check failures: ${base.consecutive_failures} (threshold ${threshold})`,
    `Latest failed check: ${formatMelbourne(latestFailureStartedAtUtc)} (${latestFailureStartedAtUtc} UTC)`,
    `Latest failure summary: ${failureSummary}`,
    "",
    `Scoring log: ${scoringLogUrl}`,
    "",
    `Cooldown: one alert every ${cooldownMinutes} minutes while failures continue.`,
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.45; color: #111;">
      <p><b>Automated alert</b> from Needlessly Complicated AFL Tipping.</p>
      <p>
        Season: <b>${params.season}</b><br />
        Competition ID: <b>${params.competitionId}</b><br />
        Trigger mode: <b>${params.triggerMode}</b><br />
        Consecutive active-check failures: <b>${base.consecutive_failures}</b> (threshold ${threshold})<br />
        Latest failed check: <b>${formatMelbourne(latestFailureStartedAtUtc)}</b> (${latestFailureStartedAtUtc} UTC)
      </p>
      <p><b>Latest failure summary:</b><br />${failureSummary}</p>
      <p><a href="${scoringLogUrl}">Open scoring log</a></p>
      <p style="margin-top: 20px;">Cooldown: one alert every ${cooldownMinutes} minutes while failures continue.</p>
    </div>
  `;

  const sendResult = await sendAlertEmail({
    apiKey: resendApiKey,
    fromEmail,
    replyTo,
    toEmail: recipient,
    subject,
    text,
    html,
  });

  if (!sendResult.ok) {
    base.skipped_reason = "send_failed";
    base.error = sendResult.error;
    return base;
  }

  const alertInsert = await params.supabase.from("automation_alert_events").insert({
    competition_id: params.competitionId,
    season: params.season,
    alert_key: ACTIVE_SCORING_FAILURE_ALERT_KEY,
    alert_channel: "email",
    target: recipient,
    context: {
      run_id: params.runId,
      consecutive_failures: base.consecutive_failures,
      threshold,
      cooldown_minutes: cooldownMinutes,
      latest_failed_started_at_utc: latestFailureStartedAtUtc,
      latest_failure_summary: failureSummary,
      provider_message_id: sendResult.providerMessageId,
    },
  });

  if (alertInsert.error) {
    base.alert_log_error = isMissingRelationError(
      alertInsert.error.message,
      "automation_alert_events"
    )
      ? `${alertInsert.error.message} (hint: apply migration db/migrations/20260415_automation_alert_events.sql)`
      : alertInsert.error.message;
  } else {
    base.alert_logged = true;
  }

  base.sent = true;
  base.skipped_reason = null;
  return base;
}

function normalizeScope(raw: string | null) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return value === "full" ? "full" : "active";
}

function normalizeJobKind(raw: string | null, scope: "active" | "full") {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "scoring_15m" || value === "scoring_daily_full" || value === "manual") {
    return value;
  }
  return scope === "full" ? "scoring_daily_full" : "scoring_15m";
}

function parseSyncUpdated(syncJson: Record<string, unknown>) {
  if (typeof syncJson.updated === "number") return syncJson.updated;
  const parsed = Number(syncJson.updated ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function parseSyncRoundsTargeted(syncJson: Record<string, unknown>) {
  if (typeof syncJson.roundsTargetedCount === "number") return syncJson.roundsTargetedCount;
  if (typeof syncJson.rounds_targeted === "number") return syncJson.rounds_targeted;
  const parsed = Number(syncJson.roundsTargetedCount ?? syncJson.rounds_targeted ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export async function GET(req: Request) {
  const startedAtUtc = new Date().toISOString();

  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    const scope = normalizeScope(url.searchParams.get("scope")) as "active" | "full";
    const jobKind = normalizeJobKind(
      url.searchParams.get("job_kind"),
      scope
    ) as "scoring_15m" | "scoring_daily_full" | "manual";

    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await resolveCompetitionIdForAdminRequest(req, supabase);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const bearer = gate.mode === "bearer" ? gate.token : null;
    const secretQS =
      gate.mode === "cron" ? `&secret=${encodeURIComponent(gate.secret)}` : "";
    const origin = url.origin;

    async function call(path: string): Promise<AdminCallResult> {
      const headers: Record<string, string> = {};
      if (bearer) headers.Authorization = `Bearer ${bearer}`;

      const res = await fetch(origin + path, { headers, cache: "no-store" });
      const text = await res.text();
      try {
        return { status: res.status, json: JSON.parse(text) as Record<string, unknown> };
      } catch {
        return {
          status: res.status,
          json: { error: "Non-JSON response", bodyHead: text.slice(0, 500) },
        };
      }
    }

    const syncResults = await call(
      `/api/admin/sync-results?season=${season}&scope=${scope}&competition_id=${competitionId}${secretQS}`
    );

    const syncOk =
      syncResults.status >= 200 &&
      syncResults.status < 300 &&
      (syncResults.json.ok === true || syncResults.json.success === true);
    const syncUpdated = Math.max(0, Math.trunc(parseSyncUpdated(syncResults.json)));
    const roundsTargetedCount = Math.max(
      0,
      Math.trunc(parseSyncRoundsTargeted(syncResults.json))
    );
    const skipIdleActiveRun =
      scope === "active" && jobKind === "scoring_15m" && syncOk && roundsTargetedCount === 0;

    if (skipIdleActiveRun) {
      const finishedAtUtc = new Date().toISOString();
      const details = {
        sync_results: syncResults,
        recalc_leaderboard: {
          status: 412,
          json: {
            ok: false,
            error: "Skipped recalc because there is no locked unfinished round.",
          },
        },
        skip_reason: "no_live_round",
      };

      let logInsertError: string | null = null;
      const logInsert = await supabase.from("scoring_automation_runs").insert({
        competition_id: competitionId,
        season,
        job_kind: jobKind,
        scope,
        trigger_mode: gate.mode,
        run_status: "success",
        sync_ok: syncOk,
        sync_updated: syncUpdated,
        leaderboard_recalc_ran: false,
        leaderboard_recalc_ok: null,
        started_at_utc: startedAtUtc,
        finished_at_utc: finishedAtUtc,
        details,
      });

      if (logInsert.error) {
        logInsertError = logInsert.error.message;
        if (isMissingRelationError(logInsert.error.message, "scoring_automation_runs")) {
          logInsertError =
            `${logInsert.error.message} (hint: apply migration db/migrations/20260327_scoring_automation_runs.sql)`;
        }
      }

      return NextResponse.json({
        ok: true,
        season,
        competition_id: competitionId,
        scope,
        job_kind: jobKind,
        run_status: "skipped",
        skip_reason: "no_live_round",
        rounds_targeted: roundsTargetedCount,
        sync_updated: syncUpdated,
        recalc_triggered: false,
        steps: details,
        log_saved: !logInsertError,
        log_error: logInsertError,
        started_at_utc: startedAtUtc,
        finished_at_utc: finishedAtUtc,
      });
    }

    const shouldRecalc = syncOk && syncUpdated > 0;
    const recalcLeaderboard = shouldRecalc
      ? await call(
        `/api/admin/recalc-leaderboard?season=${season}&competition_id=${competitionId}${secretQS}`
      )
      : {
        status: 412,
        json: {
          ok: false,
          error: syncOk
            ? "Skipped recalc because sync-results.updated was 0"
            : "Skipped recalc because sync-results failed",
        },
      };

    const recalcOk =
      recalcLeaderboard.status >= 200 &&
      recalcLeaderboard.status < 300 &&
      (recalcLeaderboard.json.ok === true || recalcLeaderboard.json.success === true);

    const shouldRunAutoRoundRecap =
      syncOk && (syncUpdated > 0 || jobKind === "scoring_daily_full");
    const autoRoundRecap = shouldRunAutoRoundRecap
      ? await call(
        `/api/admin/send-round-recap?season=${season}&save_only=1&hours_after_first=0&skip_if_exists=1&competition_id=${competitionId}${secretQS}`
      )
      : {
        status: 412,
        json: {
          ok: false,
          error: syncOk
            ? "Skipped auto recap because sync-results.updated was 0"
            : "Skipped auto recap because sync-results failed",
        },
      };
    const autoRoundRecapOk =
      autoRoundRecap.status >= 200 &&
      autoRoundRecap.status < 300 &&
      (autoRoundRecap.json.ok === true || autoRoundRecap.json.success === true);

    const runStatus: ScoringRunStatus =
      syncOk && (!shouldRecalc || recalcOk) ? "success" : "failed";
    const finishedAtUtc = new Date().toISOString();

    let details: Record<string, unknown> = {
      sync_results: syncResults,
      recalc_leaderboard: recalcLeaderboard,
      auto_round_recap: autoRoundRecap,
    };

    let logInsertError: string | null = null;
    let insertedRunId: string | null = null;
    const logInsert = await supabase
      .from("scoring_automation_runs")
      .insert({
        competition_id: competitionId,
        season,
        job_kind: jobKind,
        scope,
        trigger_mode: gate.mode,
        run_status: runStatus,
        sync_ok: syncOk,
        sync_updated: syncUpdated,
        leaderboard_recalc_ran: shouldRecalc,
        leaderboard_recalc_ok: shouldRecalc ? recalcOk : null,
        started_at_utc: startedAtUtc,
        finished_at_utc: finishedAtUtc,
        details,
      })
      .select("id")
      .maybeSingle();

    if (logInsert.error) {
      logInsertError = logInsert.error.message;
      if (isMissingRelationError(logInsert.error.message, "scoring_automation_runs")) {
        logInsertError =
          `${logInsert.error.message} (hint: apply migration db/migrations/20260327_scoring_automation_runs.sql)`;
      }
    } else {
      const inserted = (logInsert.data ?? null) as ScoringRunInsertRow | null;
      insertedRunId = typeof inserted?.id === "string" ? inserted.id : null;
    }

    const activeFailureAlert = await maybeSendActiveFailureAlert({
      supabase,
      competitionId,
      season,
      origin,
      runStatus,
      jobKind,
      triggerMode: gate.mode,
      runId: insertedRunId,
    });

    details = {
      ...details,
      active_failure_alert: activeFailureAlert,
    };

    if (insertedRunId) {
      const detailsUpdate = await supabase
        .from("scoring_automation_runs")
        .update({ details })
        .eq("id", insertedRunId);
      if (detailsUpdate.error) {
        const detailWriteError = detailsUpdate.error.message;
        details.active_failure_alert = {
          ...activeFailureAlert,
          details_update_error: detailWriteError,
        };
      }
    }

    // Retention cleanup runs only on the once-daily full pass.
    const shouldRunLogCleanup = jobKind === "scoring_daily_full";
    const cleanupRetentionHours = 72;
    const cleanupCutoffUtc = new Date(
      Date.now() - cleanupRetentionHours * 60 * 60 * 1000
    ).toISOString();
    let logCleanupDeleted: number | null = null;
    let logCleanupError: string | null = null;

    if (shouldRunLogCleanup) {
      const cleanup = await supabase
        .from("scoring_automation_runs")
        .delete({ count: "exact" })
        .eq("competition_id", competitionId)
        .lt("started_at_utc", cleanupCutoffUtc);

      if (cleanup.error) {
        logCleanupError = cleanup.error.message;
        if (isMissingRelationError(cleanup.error.message, "scoring_automation_runs")) {
          logCleanupError =
            `${cleanup.error.message} (hint: apply migration db/migrations/20260327_scoring_automation_runs.sql)`;
        }
      } else if (typeof cleanup.count === "number") {
        logCleanupDeleted = cleanup.count;
      }
    }

    return NextResponse.json({
      ok: runStatus === "success",
      season,
      competition_id: competitionId,
      scope,
      job_kind: jobKind,
      run_status: runStatus,
      sync_updated: syncUpdated,
      recalc_triggered: shouldRecalc,
      auto_round_recap_triggered: shouldRunAutoRoundRecap,
      auto_round_recap_ok: autoRoundRecapOk,
      steps: details,
      active_failure_alert: activeFailureAlert,
      log_saved: !logInsertError,
      log_error: logInsertError,
      log_cleanup: {
        ran: shouldRunLogCleanup,
        retention_hours: cleanupRetentionHours,
        cutoff_utc: shouldRunLogCleanup ? cleanupCutoffUtc : null,
        deleted: logCleanupDeleted,
        error: logCleanupError,
      },
      started_at_utc: startedAtUtc,
      finished_at_utc: finishedAtUtc,
    });
  } catch (e: unknown) {
    const finishedAtUtc = new Date().toISOString();
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        error: "Unexpected error",
        details: message,
        started_at_utc: startedAtUtc,
        finished_at_utc: finishedAtUtc,
      },
      { status: 500 }
    );
  }
}
