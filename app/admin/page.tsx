"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useToast } from "@/components/ToastProvider";
import { UiButton, UiButtonLink, UiCard } from "@/components/ui";
import { CURRENT_SEASON, NEXT_SEASON, SIGNUPS_OPEN } from "@/lib/season-config";

type ConfirmAction = {
  title: string;
  body: string;
  confirmLabel: string;
  path: string;
};

type AutomationHealthRun = {
  id: string;
  job_kind: string;
  job_label: string;
  trigger_mode: string;
  run_status: string;
  started_at_utc: string;
  summary: string;
};

type AutomationHealthResponse = {
  ok?: boolean;
  healthy?: boolean;
  failure_window_hours?: number;
  latest?: AutomationHealthRun[];
  recent_failures?: AutomationHealthRun[];
  error?: string;
  details?: string;
  sources?: {
    automation_job_runs?: { ok?: boolean; hint?: string | null };
    scoring_automation_runs?: { ok?: boolean; hint?: string | null };
  };
};

type AdminAnomalyRow = {
  id: string;
  dismiss_key: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
  cta: string;
  category: "automation" | "odds" | "results" | "payments" | "recaps" | "growth";
};

type AdminAnomaliesResponse = {
  ok?: boolean;
  anomalies?: AdminAnomalyRow[];
  counts?: {
    total?: number;
    critical?: number;
    warning?: number;
    info?: number;
  };
  error?: string;
  details?: string;
  sources?: Record<string, string | null | undefined>;
};

function parseResultObject(value: unknown) {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function summarizeResult(value: unknown) {
  const obj = parseResultObject(value);
  if (!obj) return "Latest response available.";

  const error = typeof obj.error === "string" ? obj.error.trim() : "";
  if (error) return `Error: ${error}`;

  const action = typeof obj.action === "string" ? obj.action.trim() : "";
  const note = typeof obj.note === "string" ? obj.note.trim() : "";
  const updated = typeof obj.updated === "number" ? obj.updated : null;

  if (action === "sync-results-and-recalc-leaderboard") {
    if (obj.ok === true && obj.recalcSkipped === true) {
      return note || "Results sync finished. Leaderboard recalc was skipped because no updates were found.";
    }
    if (obj.ok === true) {
      return "Results sync and leaderboard refresh completed.";
    }
    return "Results sync or leaderboard refresh returned an issue.";
  }

  if (updated !== null) {
    return `Completed with ${updated} update${updated === 1 ? "" : "s"}.`;
  }

  if (obj.ok === true && note) return note;
  if (obj.ok === true) return "Action completed successfully.";

  return "Latest response available.";
}

function describeRunningAction(value: string | null) {
  if (!value) return "";
  if (value === "sync-and-recalc") return "Syncing results and recalculating leaderboard...";
  if (value.includes("sync-results")) return "Syncing results...";
  if (value.includes("recalc-leaderboard")) return "Recalculating leaderboard...";
  if (value.includes("sync-fixture")) return "Syncing fixture...";
  if (value.includes("snapshot-odds-all-due") && value.includes("force=1")) {
    return "Running force snapshot...";
  }
  if (value.includes("snapshot-odds-all-due")) return "Capturing due odds snapshot...";
  if (value.includes("send-round-recap")) return "Generating round recap...";
  return `Running: ${value}`;
}

function anomalyBadgeStyle(severity: "critical" | "warning" | "info"): CSSProperties {
  if (severity === "critical") {
    return {
      background: "var(--tone-danger-bg)",
      color: "var(--tone-danger-text)",
      border: "1px solid rgba(239, 68, 68, 0.25)",
    };
  }
  if (severity === "warning") {
    return {
      background: "var(--tone-warning-bg)",
      color: "var(--tone-warning-text)",
      border: "1px solid rgba(245, 158, 11, 0.25)",
    };
  }
  return {
    background: "var(--tone-info-bg)",
    color: "var(--tone-info-text)",
    border: "1px solid rgba(59, 130, 246, 0.22)",
  };
}

export default function AdminPage() {
  const toast = useToast();
  const [season, setSeason] = useState<number>(CURRENT_SEASON);
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthData, setHealthData] = useState<AutomationHealthResponse | null>(null);
  const [healthMsg, setHealthMsg] = useState("");
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyData, setAnomalyData] = useState<AdminAnomaliesResponse | null>(null);
  const [anomalyMsg, setAnomalyMsg] = useState("");
  const [dismissingAnomalyId, setDismissingAnomalyId] = useState<string | null>(null);
  const isRunning = loading !== null;

  useEffect(() => {
    void Promise.all([loadAutomationHealth(), loadAnomalies()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  useEffect(() => {
    function openTargetDetails() {
      if (typeof window === "undefined") return;
      const targetHash = window.location.hash;
      if (targetHash !== "#admin-maintenance" && targetHash !== "#admin-recovery") return;
      const target = document.querySelector<HTMLDetailsElement>(targetHash);
      if (target?.tagName === "DETAILS") target.open = true;
    }

    openTargetDetails();
    window.addEventListener("hashchange", openTargetDetails);
    return () => window.removeEventListener("hashchange", openTargetDetails);
  }, []);

  const resultSummary = useMemo(() => summarizeResult(result), [result]);
  const runningLabel = useMemo(() => describeRunningAction(loading), [loading]);
  const healthFailureCount = healthData?.recent_failures?.length ?? 0;
  const healthWarning =
    (healthData?.sources?.automation_job_runs?.ok === false &&
      healthData?.sources?.automation_job_runs?.hint) ||
    (healthData?.sources?.scoring_automation_runs?.ok === false &&
      healthData?.sources?.scoring_automation_runs?.hint) ||
    "";
  const anomalyTotal = anomalyData?.counts?.total ?? 0;
  const anomalySourceWarnings = useMemo(
    () =>
      Object.values(anomalyData?.sources ?? {}).filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      ),
    [anomalyData?.sources]
  );
  const showOnboarding = !SIGNUPS_OPEN || season >= NEXT_SEASON;
  const seasonScopeLabel =
    season === CURRENT_SEASON
      ? `Current season (${CURRENT_SEASON})`
      : season === NEXT_SEASON
        ? `Next season prep (${NEXT_SEASON})`
        : `Selected season (${season})`;

  async function getToken() {
    const { data } = await supabaseBrowser.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function callAdmin(path: string, token: string) {
    const res = await fetch(path, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }

  async function loadAutomationHealth() {
    try {
      setHealthLoading(true);
      setHealthMsg("");

      const token = await getToken();
      if (!token) {
        setHealthData(null);
        setHealthMsg("Sign in again to load automation health.");
        return;
      }

      const params = new URLSearchParams({
        season: String(season),
        limit: "12",
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
        setHealthData(json);
        setHealthMsg(parts.join(" - "));
        return;
      }

      setHealthData(json);
    } catch (error: unknown) {
      setHealthData(null);
      setHealthMsg(error instanceof Error ? error.message : "Could not load automation health.");
    } finally {
      setHealthLoading(false);
    }
  }

  async function loadAnomalies() {
    try {
      setAnomalyLoading(true);
      setAnomalyMsg("");

      const token = await getToken();
      if (!token) {
        setAnomalyData(null);
        setAnomalyMsg("Sign in again to load admin anomalies.");
        return;
      }

      const params = new URLSearchParams({
        season: String(season),
        limit: "8",
      });
      const res = await fetch(`/api/admin/anomalies?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = (await res.json().catch(() => null)) as AdminAnomaliesResponse | null;

      if (!res.ok || !json?.ok) {
        const parts = [json?.error ?? "Could not load admin anomalies."];
        if (json?.details) parts.push(json.details);
        setAnomalyData(json);
        setAnomalyMsg(parts.join(" - "));
        return;
      }

      setAnomalyData(json);
    } catch (error: unknown) {
      setAnomalyData(null);
      setAnomalyMsg(error instanceof Error ? error.message : "Could not load admin anomalies.");
    } finally {
      setAnomalyLoading(false);
    }
  }

  async function dismissAnomaly(anomaly: AdminAnomalyRow) {
    try {
      setDismissingAnomalyId(anomaly.id);
      const token = await getToken();
      if (!token) {
        toast.error("Not authenticated. Please sign in again.");
        return;
      }

      const res = await fetch("/api/admin/anomalies/dismiss", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          season,
          dismiss_key: anomaly.dismiss_key || anomaly.id,
          hours: 24,
        }),
      });

      const json = (await res.json().catch(() => null)) as
        | { error?: string; details?: string }
        | null;

      if (!res.ok || !json || (typeof json.error === "string" && json.error)) {
        const parts = [json?.error ?? "Could not dismiss anomaly."];
        if (json?.details) parts.push(json.details);
        toast.error(parts.join(" - "));
        return;
      }

      toast.success("Dismissed for 24 hours.");
      await loadAnomalies();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not dismiss anomaly.");
    } finally {
      setDismissingAnomalyId(null);
    }
  }

  async function run(path: string) {
    try {
      setLoading(path);
      setResult(null);

      const token = await getToken();

      if (!token) {
        setResult({ error: "Not authenticated." });
        toast.error("Not authenticated. Please sign in again.");
        return;
      }

      const { ok, status, json } = await callAdmin(path, token);
      setResult(json);
      if (!ok) {
        const message =
          (json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
            ? (json as { error?: string }).error
            : null) ?? `Request failed (${status}).`;
        toast.error(message);
      } else {
        toast.success(summarizeResult(json));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setResult({ error: message });
      toast.error(message);
    } finally {
      setLoading(null);
      void Promise.all([loadAutomationHealth(), loadAnomalies()]);
    }
  }

  async function runSyncAndRecalc() {
    try {
      setLoading("sync-and-recalc");
      setResult(null);

      const token = await getToken();
      if (!token) {
        setResult({ error: "Not authenticated." });
        toast.error("Not authenticated. Please sign in again.");
        return;
      }

      const sync = await callAdmin(`/api/admin/sync-results?season=${season}`, token);
      if (!sync.ok) {
        setResult({
          ok: false,
          step: "sync-results",
          status: sync.status,
          result: sync.json,
        });
        toast.error(
          (sync.json && typeof sync.json === "object" && typeof sync.json.error === "string"
            ? sync.json.error
            : null) ?? "Sync results failed."
        );
        return;
      }

      const syncUpdated =
        typeof sync.json === "object" &&
        sync.json !== null &&
        typeof (sync.json as Record<string, unknown>).updated === "number"
          ? ((sync.json as Record<string, unknown>).updated as number)
          : Number((sync.json as Record<string, unknown>)?.updated ?? 0);

      if (Number.isFinite(syncUpdated) && syncUpdated <= 0) {
        setResult({
          ok: true,
          season,
          action: "sync-results-and-recalc-leaderboard",
          syncResults: sync.json,
          recalcSkipped: true,
          note: "Skipped recalculate leaderboard because sync-results.updated was 0.",
        });
        toast.info("Results checked. Leaderboard refresh was skipped because nothing changed.");
        return;
      }

      const recalc = await callAdmin(`/api/admin/recalc-leaderboard?season=${season}`, token);
      const nextResult = {
        ok: recalc.ok,
        season,
        action: "sync-results-and-recalc-leaderboard",
        syncResults: sync.json,
        recalcLeaderboard: recalc.json,
      };
      setResult(nextResult);
      if (recalc.ok) {
        toast.success("Results sync and leaderboard refresh completed.");
      } else {
        toast.error(
          (recalc.json &&
          typeof recalc.json === "object" &&
          typeof (recalc.json as { error?: unknown }).error === "string"
            ? (recalc.json as { error?: string }).error
            : null) ?? "Leaderboard refresh failed."
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setResult({ error: message });
      toast.error(message);
    } finally {
      setLoading(null);
      void Promise.all([loadAutomationHealth(), loadAnomalies()]);
    }
  }

  function runForceSnapshotNow() {
    setConfirmAction({
      title: "Run force snapshot now?",
      body: "This will capture odds immediately even when a snapshot is not currently due.",
      confirmLabel: "Yes, run force snapshot",
      path: `/api/admin/snapshot-odds-all-due?season=${season}&force=1`,
    });
  }

  function closeConfirm() {
    if (isRunning) return;
    setConfirmAction(null);
  }

  async function confirmAndRun() {
    if (!confirmAction) return;
    const path = confirmAction.path;
    setConfirmAction(null);
    await run(path);
  }

  const dominantAnomalySeverity: AdminAnomalyRow["severity"] =
    (anomalyData?.counts?.critical ?? 0) > 0
      ? "critical"
      : (anomalyData?.counts?.warning ?? 0) > 0
        ? "warning"
        : "info";
  const anomalyStatusStyle =
    anomalyTotal > 0
      ? anomalyBadgeStyle(dominantAnomalySeverity)
      : {
          background: "var(--tone-success-bg)",
          color: "var(--tone-success-text)",
          border: "1px solid rgba(16, 185, 129, 0.22)",
        };
  const anomalyStatusLabel = anomalyLoading
    ? "CHECKING"
    : anomalyTotal > 0
      ? `${anomalyTotal} OPEN`
      : "ALL CLEAR";
  const healthStatusLabel = healthLoading
    ? "CHECKING"
    : healthData?.healthy === false
      ? "ATTENTION NEEDED"
      : "ALL CLEAR";
  const healthStatusStyle = {
    background: healthData?.healthy === false ? "var(--tone-danger-bg)" : "var(--tone-success-bg)",
    color: healthData?.healthy === false ? "var(--tone-danger-text)" : "var(--tone-success-text)",
    border: "1px solid rgba(0,0,0,0.08)",
  };
  const healthSummary = healthMsg
    ? healthMsg
    : healthData?.healthy === false
      ? `${healthFailureCount} failed automation run${
          healthFailureCount === 1 ? "" : "s"
        } in the last ${healthData?.failure_window_hours ?? 72} hours.`
      : `No failed automation runs in the last ${healthData?.failure_window_hours ?? 72} hours.`;
  const healthDotClass =
    healthData?.healthy === false
      ? "ui-admin-status-dot--danger"
      : healthLoading
        ? "ui-admin-status-dot--warning"
        : "ui-admin-status-dot--success";
  const latestActionSummary =
    result === null
      ? "No admin action has run in this browser session."
      : resultSummary;

  return (
    <main className="ui-page ui-page--wide ui-admin-page">
      <div className="ui-page-header">
        <div>
          <h1 className="ui-title">Admin Centre</h1>
          <div className="ui-caption ui-mt-1">
            Current issues, routine operations, settings, and rare recovery each have their own lane.
          </div>
        </div>
        <span className="ui-badge" style={anomalyStatusStyle}>
          {anomalyStatusLabel}
        </span>
      </div>

      <UiCard soft className="ui-admin-control-bar">
        <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 12 }}>
          <div className="ui-admin-stack-tight">
            <div className="ui-admin-kicker">{seasonScopeLabel}</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Scoring, health, logs, recaps, and recovery actions are scoped to this season.
            </div>
          </div>
          <div className="ui-row-wrap ui-admin-gap-sm" style={{ alignItems: "center" }}>
            <label className="ui-admin-label" htmlFor="admin-season-input">
              Season
            </label>
            <input
              id="admin-season-input"
              type="number"
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              className="ui-input ui-admin-input-season"
            />
          </div>
        </div>
      </UiCard>

      <section className="ui-admin-control-grid" aria-label="Admin control room">
        <UiCard soft className="ui-admin-section">
          <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 10 }}>
            <div>
              <h2 className="ui-admin-section-title">Today</h2>
              <div className="ui-admin-summary ui-admin-summary--tight">
                This is the only queue that should feel urgent.
              </div>
            </div>
            <span className="ui-badge" style={anomalyStatusStyle}>
              {anomalyStatusLabel}
            </span>
          </div>

          {anomalyMsg ? (
            <div className="ui-admin-summary" style={{ color: "var(--tone-danger-text)" }}>
              {anomalyMsg}
            </div>
          ) : anomalyTotal === 0 && !anomalyLoading ? (
            <div className="ui-admin-action-item">
              <div className="ui-admin-subtitle">Nothing urgent right now</div>
              <div className="ui-admin-summary ui-admin-summary--tight">
                No current issues for this season.
              </div>
            </div>
          ) : (
            <div className="ui-admin-anomaly-list">
              {(anomalyData?.anomalies ?? []).map((anomaly) => (
                <div key={anomaly.id} className="ui-admin-action-item ui-admin-anomaly-item">
                  <div className="ui-admin-anomaly-top">
                    <div className="ui-admin-stack-tight">
                      <div className="ui-admin-subtitle">{anomaly.title}</div>
                      <div className="ui-admin-summary ui-admin-summary--tight">{anomaly.detail}</div>
                    </div>
                    <span className="ui-badge" style={anomalyBadgeStyle(anomaly.severity)}>
                      {anomaly.severity.toUpperCase()}
                    </span>
                  </div>
                  <div className="ui-row-wrap">
                    <UiButtonLink href={anomaly.href} className="ui-admin-btn">
                      {anomaly.cta}
                    </UiButtonLink>
                    <UiButton
                      disabled={dismissingAnomalyId === anomaly.id}
                      onClick={() => void dismissAnomaly(anomaly)}
                      className="ui-admin-btn"
                    >
                      {dismissingAnomalyId === anomaly.id ? "Dismissing..." : "Dismiss (24h)"}
                    </UiButton>
                  </div>
                </div>
              ))}
            </div>
          )}

          {anomalySourceWarnings.length > 0 && (
            <div className="ui-admin-stack" style={{ marginTop: 4 }}>
              {anomalySourceWarnings.map((warning) => (
                <div key={warning} className="ui-admin-summary ui-admin-summary--tight" style={{ color: "var(--tone-warning-text)" }}>
                  {warning}
                </div>
              ))}
            </div>
          )}

          <div className="ui-row-wrap ui-admin-gap-sm">
            <UiButton
              disabled={anomalyLoading}
              onClick={() => void loadAnomalies()}
              className="ui-admin-btn"
            >
              {anomalyLoading ? "Refreshing..." : "Refresh Inbox"}
            </UiButton>
          </div>
        </UiCard>

        <div className="ui-admin-status-column">
          <UiCard soft className="ui-admin-section">
            <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 10 }}>
              <div>
                <h2 className="ui-admin-section-title">Status</h2>
                <div className="ui-admin-summary ui-admin-summary--tight">
                  Quick read before touching anything.
                </div>
              </div>
              <span className="ui-badge" style={healthStatusStyle}>
                {healthStatusLabel}
              </span>
            </div>

            <div className="ui-admin-status-list">
              <div className="ui-admin-status-row">
                <span
                  className={`ui-admin-status-dot ${
                    anomalyTotal > 0 ? "ui-admin-status-dot--warning" : "ui-admin-status-dot--success"
                  }`}
                  aria-hidden="true"
                />
                <div>
                  <div className="ui-admin-subtitle">Needs attention</div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    {anomalyStatusLabel}
                  </div>
                </div>
              </div>
              <div className="ui-admin-status-row">
                <span className={`ui-admin-status-dot ${healthDotClass}`} aria-hidden="true" />
                <div>
                  <div className="ui-admin-subtitle">Automation</div>
                  <div className="ui-admin-summary ui-admin-summary--tight">{healthSummary}</div>
                  {healthWarning && (
                    <div
                      className="ui-admin-summary ui-admin-summary--tight"
                      style={{ color: "var(--tone-warning-text)" }}
                    >
                      {healthWarning}
                    </div>
                  )}
                </div>
              </div>
              <div className="ui-admin-status-row">
                <span className="ui-admin-status-dot ui-admin-status-dot--success" aria-hidden="true" />
                <div>
                  <div className="ui-admin-subtitle">Latest action</div>
                  <div className="ui-admin-summary ui-admin-summary--tight">{latestActionSummary}</div>
                </div>
              </div>
            </div>

            <div className="ui-row-wrap ui-admin-gap-sm">
              <UiButton
                disabled={healthLoading}
                onClick={() => void loadAutomationHealth()}
                className="ui-admin-btn"
              >
                {healthLoading ? "Refreshing..." : "Refresh Health"}
              </UiButton>
              <UiButtonLink
                href={`/admin/automation-health?season=${encodeURIComponent(String(season))}`}
                className="ui-admin-btn"
              >
                Open Runs
              </UiButtonLink>
            </div>
          </UiCard>

          <UiCard soft className="ui-admin-section">
            <h2 className="ui-admin-section-title">Weekly Rhythm</h2>
            <div className="ui-admin-rhythm-list">
              <div className="ui-admin-rhythm-item">
                <div className="ui-admin-kicker">Before lock</div>
                <div className="ui-admin-summary ui-admin-summary--tight">
                  Check automation health, payment locks, and due odds snapshots.
                </div>
              </div>
              <div className="ui-admin-rhythm-item">
                <div className="ui-admin-kicker">After round</div>
                <div className="ui-admin-summary ui-admin-summary--tight">
                  Sync results, recalculate the leaderboard, then generate or review the recap.
                </div>
              </div>
              <div className="ui-admin-rhythm-item">
                <div className="ui-admin-kicker">Season admin</div>
                <div className="ui-admin-summary ui-admin-summary--tight">
                  Keep roster, payments, and onboarding in the member lifecycle lane.
                </div>
              </div>
            </div>
          </UiCard>
        </div>
      </section>

      <section className="ui-admin-operation-section" aria-labelledby="admin-routine-heading">
        <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 10 }}>
          <div>
            <h2 id="admin-routine-heading" className="ui-admin-section-title">
              Routine Operations
            </h2>
            <div className="ui-admin-summary ui-admin-summary--tight">
              These are the normal places to work during the week.
            </div>
          </div>
          <span className="ui-badge">Common tools</span>
        </div>

        <div className="ui-admin-operation-grid">
          <UiCard className="ui-admin-operation-card ui-admin-operation-card--primary">
            <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
              <div className="ui-admin-subtitle">Results recovery</div>
              <span className="ui-badge">Primary</span>
            </div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Run the full scoring repair flow first. Single-step tools live in rare recovery.
            </div>
            <div className="ui-admin-operation-actions">
              <UiButton
                disabled={isRunning}
                onClick={runSyncAndRecalc}
                className="ui-admin-btn ui-admin-btn--full ui-admin-btn--primary"
              >
                Sync Results + Recalculate Leaderboard
              </UiButton>
              <UiButtonLink
                href={`/admin/scoring-sync?season=${encodeURIComponent(String(season))}`}
                className="ui-admin-btn ui-admin-btn--full"
              >
                Open Scoring Log
              </UiButtonLink>
            </div>
          </UiCard>

          <UiCard className="ui-admin-operation-card">
            <div className="ui-admin-subtitle">Members &amp; money</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Roster, payment reconciliation, and next-season onboarding stay together.
            </div>
            <div className="ui-admin-operation-actions">
              <UiButtonLink
                href={`/admin/roster/${CURRENT_SEASON}`}
                className="ui-admin-btn ui-admin-btn--full"
              >
                Open Season Roster
              </UiButtonLink>
              <UiButtonLink href="/admin/payments" className="ui-admin-btn ui-admin-btn--full">
                Open Payments
              </UiButtonLink>
              {showOnboarding && (
                <UiButtonLink href="/admin/onboarding" className="ui-admin-btn ui-admin-btn--full">
                  Open Onboarding ({NEXT_SEASON})
                </UiButtonLink>
              )}
            </div>
          </UiCard>

          <UiCard className="ui-admin-operation-card">
            <div className="ui-admin-subtitle">Comms</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Member-facing updates and recap emails are treated as one communication workflow.
            </div>
            <div className="ui-admin-operation-actions">
              <UiButtonLink href="/announcements" className="ui-admin-btn ui-admin-btn--full">
                Open Announcements
              </UiButtonLink>
              <UiButtonLink href="/admin/recaps" className="ui-admin-btn ui-admin-btn--full">
                Open Round Recaps
              </UiButtonLink>
            </div>
          </UiCard>
        </div>
      </section>

      <details
        id="admin-maintenance"
        className="ui-card ui-card-soft ui-admin-section ui-admin-details ui-admin-operation-section"
      >
        <summary className="ui-admin-details-summary">Settings, Logs &amp; Archives</summary>
        <div className="ui-admin-summary">
          Lower-frequency controls and history pages. They are useful, but they should not compete
          with today&apos;s queue.
        </div>

        <div className="ui-admin-directory-grid">
          <div className="ui-admin-action-item">
            <div className="ui-admin-subtitle">People settings</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Champion settings, payment lock settings, and cross-season people edits.
            </div>
            <UiButtonLink href="/admin/settings/people" className="ui-admin-btn ui-admin-btn--full">
              Open People Settings
            </UiButtonLink>
          </div>

          <div className="ui-admin-action-item">
            <div className="ui-admin-subtitle">Audit log</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              See who changed members, settings, fixture data, results, or snapshots.
            </div>
            <UiButtonLink
              href={`/admin/audit-log?season=${encodeURIComponent(String(season))}`}
              className="ui-admin-btn ui-admin-btn--full"
            >
              Open Audit Log
            </UiButtonLink>
          </div>

          <div className="ui-admin-action-item">
            <div className="ui-admin-subtitle">Raw signups</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Back-office view for export, bulk email, and cleanup.
            </div>
            <UiButtonLink href="/admin/interested-members" className="ui-admin-btn ui-admin-btn--full">
              Open Raw Signups ({NEXT_SEASON})
            </UiButtonLink>
          </div>
        </div>

      </details>

      <details
        id="admin-recovery"
        className="ui-card ui-card-soft ui-admin-section ui-admin-details ui-admin-danger-zone"
      >
        <summary className="ui-admin-details-summary">Rare Recovery</summary>
        <div className="ui-admin-summary">
          Single-step, backfill, and testing tools. Use only when the full recovery action is not enough.
        </div>

        <div className="ui-admin-directory-grid">
          <div className="ui-admin-action-item">
            <div className="ui-admin-subtitle">Manual scoring steps</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Run one scoring step only when you intentionally want less than the full recovery flow.
            </div>
            <div className="ui-row-wrap ui-admin-gap-sm">
              <UiButton
                disabled={isRunning}
                onClick={() => run(`/api/admin/sync-results?season=${season}`)}
                className="ui-admin-btn ui-admin-btn--compact"
              >
                Sync Results Only
              </UiButton>

              <UiButton
                disabled={isRunning}
                onClick={() => run(`/api/admin/recalc-leaderboard?season=${season}`)}
                className="ui-admin-btn ui-admin-btn--compact"
              >
                Recalculate Only
              </UiButton>
            </div>
          </div>

          <div className="ui-admin-action-item">
            <div className="ui-admin-subtitle">Fixture &amp; odds maintenance</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Backfills and manual capture for fixture data or due-round odds.
            </div>
            <div className="ui-admin-operation-actions">
              <UiButton
                disabled={isRunning}
                onClick={() => run(`/api/admin/sync-fixture?season=${season}`)}
                className="ui-admin-btn ui-admin-btn--full"
              >
                Sync Fixture
              </UiButton>

              <UiButton
                disabled={isRunning}
                onClick={() => run(`/api/admin/snapshot-odds-all-due?season=${season}`)}
                className="ui-admin-btn ui-admin-btn--full"
              >
                Snapshot Next Due Round
              </UiButton>
            </div>
          </div>

          <div className="ui-admin-action-item">
            <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
              <div className="ui-admin-subtitle">Force snapshot</div>
              <span className="ui-admin-danger-chip">Rare use</span>
            </div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Forces odds capture immediately. Keep this as a deliberate testing/backfill action.
            </div>
            <UiButton
              disabled={isRunning}
              onClick={runForceSnapshotNow}
              className="ui-admin-btn ui-admin-btn--full"
              tone="dangerSoft"
            >
              Run Force Snapshot
            </UiButton>
          </div>
        </div>
      </details>

      {loading && <div className="ui-admin-running">{runningLabel}</div>}

      {result !== null && (
        <details className="ui-card ui-card-soft ui-admin-result">
          <summary className="ui-summary-plain ui-admin-result-summary">
            <div>
              <div className="ui-admin-subtitle">Latest action response</div>
              <div className="ui-admin-summary ui-admin-summary--tight">{resultSummary}</div>
            </div>
            <span className="ui-admin-result-toggle">View raw JSON</span>
          </summary>
          <pre className="ui-admin-result-pre">{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}

      {confirmAction && (
        <div onClick={closeConfirm} className="ui-admin-modal-backdrop">
          <UiCard onClick={(e) => e.stopPropagation()} className="ui-admin-modal">
            <div className="ui-admin-modal-title">{confirmAction.title}</div>
            <div className="ui-admin-modal-body">{confirmAction.body}</div>
            <div className="ui-admin-modal-actions">
              <UiButton disabled={isRunning} onClick={closeConfirm} className="ui-admin-btn">
                Cancel
              </UiButton>
              <UiButton
                disabled={isRunning}
                onClick={confirmAndRun}
                className="ui-admin-btn"
                tone="dangerSoft"
              >
                {confirmAction.confirmLabel}
              </UiButton>
            </div>
          </UiCard>
        </div>
      )}
    </main>
  );
}
