import { NextResponse } from "next/server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import {
  classifyPrelockReminderRun,
  recordAutomationJobRun,
  type AutomationJobKind,
} from "@/lib/automation-observability";
import { createServiceClient } from "@/lib/supabase-server";

export const DEFAULT_SEASON = 2026;

type ForwardCronToAdminOptions = {
  season?: number | null;
  jobKind?: AutomationJobKind | null;
};

export function parseSeason(req: Request) {
  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season") ?? String(DEFAULT_SEASON));
  if (!Number.isFinite(season) || season < 2000 || season > 2100) {
    return null;
  }
  return Math.trunc(season);
}

function withSecret(pathWithQuery: string, secret: string) {
  const joiner = pathWithQuery.includes("?") ? "&" : "?";
  return `${pathWithQuery}${joiner}secret=${encodeURIComponent(secret)}`;
}

export async function forwardCronToAdmin(
  req: Request,
  pathWithQuery: string,
  options?: ForwardCronToAdminOptions
) {
  const startedAtUtc = new Date().toISOString();
  const gate = await requireAdminOrCron(req);
  if (!gate.ok) {
    return NextResponse.json(gate.json, { status: gate.status });
  }

  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  const path =
    gate.mode === "cron" ? withSecret(pathWithQuery, gate.secret) : pathWithQuery;

  if (gate.mode === "bearer") {
    headers.Authorization = `Bearer ${gate.token}`;
  }

  const res = await fetch(`${url.origin}${path}`, {
    headers,
    cache: "no-store",
  });

  const text = await res.text();
  let body: Record<string, unknown>;
  let status = res.status;

  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    status = 502;
    body = {
      error: "Non-JSON response from admin endpoint",
      status: res.status,
      bodyHead: text.slice(0, 500),
    };
  }

  if (options?.jobKind === "prelock_reminders" && options.season != null) {
    try {
      const supabase = createServiceClient();
      const competitionId = await resolveCompetitionIdForAdminRequest(req, supabase);
      if (competitionId) {
        const classification = classifyPrelockReminderRun(body, status);
        const logError = await recordAutomationJobRun({
          competitionId,
          season: options.season,
          jobKind: "prelock_reminders",
          triggerMode: gate.mode,
          requestPath: pathWithQuery,
          startedAtUtc,
          finishedAtUtc: new Date().toISOString(),
          runStatus: classification.runStatus,
          summary: classification.summary,
          details: body,
        });
        if (logError) {
          body.observability_log_error = logError;
        }
      }
    } catch (error: unknown) {
      body.observability_log_error =
        error instanceof Error ? error.message : "Failed to record automation run";
    }
  }

  return NextResponse.json(body, { status });
}
