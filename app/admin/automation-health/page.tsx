"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  UiButton,
  UiButtonLink,
  UiCard,
  UiSectionHeader,
  UiTableCell,
  UiTableHeadCell,
  UiTableScroll,
  UiTableShell,
} from "@/components/ui";

type HealthRun = {
  source: "scoring" | "automation";
  id: string;
  competition_id: string;
  season: number;
  job_kind: string;
  job_label: string;
  trigger_mode: string;
  run_status: string;
  started_at_utc: string;
  finished_at_utc: string;
  summary: string;
  details: unknown;
};

type AutomationHealthResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  healthy?: boolean;
  failure_window_hours?: number;
  latest?: HealthRun[];
  recent_failures?: HealthRun[];
  recent_runs?: HealthRun[];
  sources?: {
    automation_job_runs?: { ok?: boolean; error?: string | null; hint?: string | null };
    scoring_automation_runs?: { ok?: boolean; error?: string | null; hint?: string | null };
  };
};

function fmtMelbourne(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function AutomationHealthPage() {
  const [season, setSeason] = useState(2026);
  const [status, setStatus] = useState("Checking login...");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Loading automation health...");
  const [payload, setPayload] = useState<AutomationHealthResponse | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  useEffect(() => {
    const rawSeason = new URLSearchParams(window.location.search).get("season");
    const parsedSeason = Number(rawSeason ?? "2026");
    if (Number.isFinite(parsedSeason)) {
      setSeason(parsedSeason);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabaseBrowser.auth.getUser();
      if (!alive) return;
      if (!data.user) {
        window.location.href = "/login";
        return;
      }
      setStatus("");
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function getToken() {
    const { data } = await supabaseBrowser.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function refresh() {
    try {
      setLoading(true);
      setMessage("Loading automation health...");

      const token = await getToken();
      if (!token) {
        setPayload(null);
        setMessage("Not authenticated.");
        return;
      }

      const params = new URLSearchParams({
        season: String(season),
        limit: "30",
      });

      const res = await fetch(`/api/admin/automation-health?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = (await res.json().catch(() => null)) as AutomationHealthResponse | null;

      if (!res.ok || !json?.ok) {
        const parts = [json?.error ?? "Could not load automation health."];
        if (json?.details) parts.push(json.details);
        setPayload(json);
        setMessage(parts.join(" - "));
        return;
      }

      setPayload(json);
      setMessage("");
    } catch (error: unknown) {
      setPayload(null);
      setMessage(error instanceof Error ? error.message : "Could not load automation health.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, season]);

  const latest = payload?.latest ?? [];
  const recentFailures = payload?.recent_failures ?? [];
  const recentRuns = payload?.recent_runs ?? [];
  const healthy = payload?.healthy ?? false;
  const failureWindowHours = payload?.failure_window_hours ?? 72;

  const sourceWarnings = useMemo(() => {
    const warnings: string[] = [];
    const automation = payload?.sources?.automation_job_runs;
    const scoring = payload?.sources?.scoring_automation_runs;
    if (automation && !automation.ok) {
      warnings.push(
        `automation_job_runs unavailable${automation.hint ? ` (${automation.hint})` : ""}`
      );
    }
    if (scoring && !scoring.ok) {
      warnings.push(
        `scoring_automation_runs unavailable${scoring.hint ? ` (${scoring.hint})` : ""}`
      );
    }
    return warnings;
  }, [payload?.sources?.automation_job_runs, payload?.sources?.scoring_automation_runs]);

  return (
    <main className="ui-page ui-page--narrow ui-admin-page">
      <div className="ui-page-header">
        <div>
          <h1 className="ui-title">Automation Health</h1>
          <div className="ui-caption ui-mt-1">
            Detailed health view for scoring, reminder, and snapshot automation once the anomaly
            inbox tells you something may be off.
          </div>
        </div>
        <div className="ui-row-wrap">
          <UiButtonLink href="/admin" className="ui-admin-btn">
            Back to Admin
          </UiButtonLink>
          <UiButton
            disabled={loading || !!status}
            onClick={() => void refresh()}
            className="ui-admin-btn ui-admin-btn--compact"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </UiButton>
        </div>
      </div>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      {!status && (
        <>
          <UiCard soft className="ui-admin-section">
            <UiSectionHeader
              title={`Season ${season} automation health`}
              subtitle={
                healthy
                  ? `All clear. No failed automation runs in the last ${failureWindowHours} hours.`
                  : `Attention needed. ${recentFailures.length} failed run${recentFailures.length === 1 ? "" : "s"} in the last ${failureWindowHours} hours.`
              }
              right={
                <div className="ui-row-wrap ui-admin-gap-sm">
                  <span className="ui-caption">Season</span>
                  <input
                    type="number"
                    value={season}
                    onChange={(e) => setSeason(Number(e.target.value))}
                    className="ui-input ui-admin-input-season"
                  />
                </div>
              }
            />

            {sourceWarnings.length > 0 && (
              <div className="ui-admin-summary" style={{ marginTop: 10, color: "rgb(153, 27, 27)" }}>
                {sourceWarnings.join(" | ")}
              </div>
            )}

            {message && <div className="ui-admin-summary" style={{ marginTop: 10 }}>{message}</div>}
          </UiCard>

          <UiCard soft className="ui-admin-section" style={{ marginTop: 12 }}>
            <div className="ui-admin-subtitle">What this page shows</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              This page is meant for diagnosis after the inbox flags something. It expands the raw
              automation picture so you can tell whether a job actually failed, was skipped for a
              harmless reason, or never recorded at all.
            </div>

            <div className="ui-admin-two-col">
              <UiCard className="ui-admin-tool">
                <div className="ui-admin-subtitle">Latest state cards</div>
                <div className="ui-admin-summary ui-admin-summary--tight">
                  The cards below show the latest recorded run for each automation stream. A green
                  card means the latest run succeeded, amber means it skipped, and red means the
                  latest run failed.
                </div>
              </UiCard>

              <UiCard className="ui-admin-tool">
                <div className="ui-admin-subtitle">Failure window</div>
                <div className="ui-admin-summary ui-admin-summary--tight">
                  The summary and failure table only call out failures in the last{" "}
                  {failureWindowHours} hours. <i>All clear</i> means no recorded failures in that
                  window, not that every job necessarily ran recently.
                </div>
              </UiCard>

              <UiCard className="ui-admin-tool">
                <div className="ui-admin-subtitle">Source warnings</div>
                <div className="ui-admin-summary ui-admin-summary--tight">
                  If a warning appears above, one of the logging tables could not be queried. That
                  usually means the diagnostic view is incomplete, not that the comp logic itself is
                  broken.
                </div>
              </UiCard>

              <UiCard className="ui-admin-tool">
                <div className="ui-admin-subtitle">Details drawer</div>
                <div className="ui-admin-summary ui-admin-summary--tight">
                  The failure details section exposes the raw stored payload for each run. Use that
                  when you need the exact error text, provider response, or skipped-reason context.
                </div>
              </UiCard>
            </div>
          </UiCard>

          <div className="ui-admin-two-col" style={{ marginTop: 12 }}>
            {latest.map((run) => (
              <UiCard key={run.job_kind} className="ui-admin-tool">
                <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                  <div className="ui-admin-subtitle">{run.job_label}</div>
                  <span
                    className="ui-badge"
                    style={{
                      background:
                        run.run_status === "failed"
                          ? "rgba(239, 68, 68, 0.14)"
                          : run.run_status === "skipped"
                            ? "rgba(245, 158, 11, 0.14)"
                            : "rgba(16, 185, 129, 0.14)",
                      color:
                        run.run_status === "failed"
                          ? "rgb(153, 27, 27)"
                          : run.run_status === "skipped"
                            ? "rgb(146, 64, 14)"
                            : "rgb(6, 95, 70)",
                      border: "1px solid rgba(0,0,0,0.08)",
                    }}
                  >
                    {run.run_status.toUpperCase()}
                  </span>
                </div>
                <div className="ui-admin-summary ui-admin-summary--tight">{run.summary}</div>
                <div className="ui-caption" style={{ marginTop: 8 }}>
                  {fmtMelbourne(run.started_at_utc)} • {run.trigger_mode}
                </div>
              </UiCard>
            ))}
          </div>

          <UiCard soft className="ui-admin-section" style={{ marginTop: 12 }}>
            <div className="ui-admin-subtitle">Recent failures</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Failed runs across scoring, reminders, and snapshot jobs.
            </div>

            <UiTableShell style={{ marginTop: 12 }}>
              <UiTableScroll>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr>
                      <UiTableHeadCell>When</UiTableHeadCell>
                      <UiTableHeadCell>Job</UiTableHeadCell>
                      <UiTableHeadCell>Source</UiTableHeadCell>
                      <UiTableHeadCell>Trigger</UiTableHeadCell>
                      <UiTableHeadCell>Summary</UiTableHeadCell>
                      <UiTableHeadCell>Details</UiTableHeadCell>
                    </tr>
                  </thead>
                  <tbody>
                    {recentFailures.length === 0 ? (
                      <tr>
                        <UiTableCell colSpan={6}>No failed automation runs in the selected window.</UiTableCell>
                      </tr>
                    ) : (
                      recentFailures.map((run) => (
                        <tr key={run.source + run.id}>
                          <UiTableCell>{fmtMelbourne(run.started_at_utc)}</UiTableCell>
                          <UiTableCell>{run.job_label}</UiTableCell>
                          <UiTableCell>{run.source}</UiTableCell>
                          <UiTableCell>{run.trigger_mode}</UiTableCell>
                          <UiTableCell>{run.summary}</UiTableCell>
                          <UiTableCell>
                            <button
                              type="button"
                              className="ui-btn ui-btn--pill"
                              onClick={() => setOpenRunId((prev) => (prev === run.id ? null : run.id))}
                            >
                              {openRunId === run.id ? "Hide" : "View"}
                            </button>
                          </UiTableCell>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </UiTableScroll>
            </UiTableShell>

            {recentFailures
              .filter((run) => openRunId === run.id)
              .map((run) => (
                <pre key={`details-${run.id}`} className="ui-admin-result-pre" style={{ marginTop: 10 }}>
                  {JSON.stringify(run.details, null, 2)}
                </pre>
              ))}
          </UiCard>

          <details className="ui-card ui-card-soft ui-admin-section" style={{ marginTop: 12 }}>
            <summary className="ui-summary-plain" style={{ cursor: "pointer" }}>
              <div>
                <div className="ui-admin-subtitle">Recent runs</div>
                <div className="ui-admin-summary ui-admin-summary--tight">
                  Latest recorded automation activity across scoring, snapshots, and reminders.
                </div>
              </div>
            </summary>

            <UiTableShell style={{ marginTop: 12 }}>
              <UiTableScroll>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr>
                      <UiTableHeadCell>When</UiTableHeadCell>
                      <UiTableHeadCell>Job</UiTableHeadCell>
                      <UiTableHeadCell>Status</UiTableHeadCell>
                      <UiTableHeadCell>Trigger</UiTableHeadCell>
                      <UiTableHeadCell>Summary</UiTableHeadCell>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRuns.length === 0 ? (
                      <tr>
                        <UiTableCell colSpan={5}>No automation runs recorded yet.</UiTableCell>
                      </tr>
                    ) : (
                      recentRuns.map((run) => (
                        <tr key={`run-${run.source}-${run.id}`}>
                          <UiTableCell>{fmtMelbourne(run.started_at_utc)}</UiTableCell>
                          <UiTableCell>{run.job_label}</UiTableCell>
                          <UiTableCell>{run.run_status}</UiTableCell>
                          <UiTableCell>{run.trigger_mode}</UiTableCell>
                          <UiTableCell>{run.summary}</UiTableCell>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </UiTableScroll>
            </UiTableShell>
          </details>
        </>
      )}
    </main>
  );
}
