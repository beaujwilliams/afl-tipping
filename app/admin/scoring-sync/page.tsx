"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  UiButton,
  UiButtonLink,
  UiCard,
  UiTableCell,
  UiTableHeadCell,
  UiTableScroll,
  UiTableShell,
} from "@/components/ui";

type ScoringAutomationRun = {
  id: string;
  job_kind: string;
  scope: "active" | "full";
  run_status: "success" | "failed";
  sync_updated: number;
  leaderboard_recalc_ran: boolean;
  leaderboard_recalc_ok: boolean | null;
  started_at_utc: string;
  finished_at_utc: string;
  details: unknown;
};

type ScoringRunsResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  hint?: string;
  runs?: ScoringAutomationRun[];
};

type RunTypeFilter = "all" | "active" | "full";

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

function toYesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function runTypeLabel(run: ScoringAutomationRun, fallback: string) {
  if (run.job_kind === "scoring_15m" || run.scope === "active") {
    return "Active round check";
  }
  if (run.job_kind === "scoring_daily_full" || run.scope === "full") {
    return "Full parse";
  }
  return fallback;
}

export default function ScoringSyncLogPage() {
  const [season, setSeason] = useState<number>(2026);
  const [runTypeFilter, setRunTypeFilter] = useState<RunTypeFilter>("all");
  const [status, setStatus] = useState<string>("Checking login...");
  const [loading, setLoading] = useState<boolean>(false);
  const [runs, setRuns] = useState<ScoringAutomationRun[]>([]);
  const [runsMsg, setRunsMsg] = useState<string>("Loading...");
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

  async function loadRuns(token: string) {
    const params = new URLSearchParams({
      season: String(season),
      limit: "80",
    });
    if (runTypeFilter === "active") {
      params.set("job_kind", "scoring_15m");
    } else if (runTypeFilter === "full") {
      params.set("job_kind", "scoring_daily_full");
    }

    const res = await fetch(
      `/api/admin/scoring-automation-runs?${params.toString()}`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const json = (await res.json().catch(() => null)) as ScoringRunsResponse | null;
    return { ok: res.ok, json };
  }

  async function refreshLogs() {
    try {
      setLoading(true);
      setRunsMsg("Loading...");

      const token = await getToken();
      if (!token) {
        setRuns([]);
        setRunsMsg("Not authenticated.");
        return;
      }

      const response = await loadRuns(token);

      if (!response.ok || !response.json?.ok) {
        const parts = [response.json?.error ?? "Could not load run history."];
        if (response.json?.details) parts.push(response.json.details);
        if (response.json?.hint) parts.push(response.json.hint);
        setRuns([]);
        setRunsMsg(parts.join(" - "));
      } else {
        const rows = Array.isArray(response.json.runs) ? response.json.runs : [];
        setRuns(rows);
        setRunsMsg(rows.length ? "" : "No scoring checks recorded yet.");
      }
    } catch {
      setRuns([]);
      setRunsMsg("Could not load run history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status) return;
    void refreshLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, season, runTypeFilter]);

  return (
    <main className="ui-page ui-page--narrow ui-admin-page">
      <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 10 }}>
        <h1 className="ui-title">Scoring sync &amp; leaderboard refresh log</h1>
        <UiButtonLink href="/admin" className="ui-admin-btn">
          Back to Admin
        </UiButtonLink>
      </div>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      {!status && (
        <>
          <UiCard soft className="ui-admin-section">
            <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="ui-admin-subtitle">What this log shows</div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    One combined run table with date/time, run type, success/failed, updated scores (yes/no), and leaderboard sync (yes/no).
                  </div>
                </div>
              <div className="ui-row-wrap ui-admin-gap-sm">
                <input
                  type="number"
                  value={season}
                  onChange={(e) => setSeason(Number(e.target.value))}
                  className="ui-input ui-admin-input-season"
                />
                <select
                  value={runTypeFilter}
                  onChange={(e) => setRunTypeFilter(e.target.value as RunTypeFilter)}
                  className="ui-input"
                  style={{ minWidth: 210 }}
                >
                  <option value="all">All run types</option>
                  <option value="active">Active round check</option>
                  <option value="full">Full parse</option>
                </select>
                <UiButton
                  disabled={loading}
                  onClick={() => void refreshLogs()}
                  className="ui-admin-btn ui-admin-btn--compact"
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </UiButton>
              </div>
            </div>
          </UiCard>

          <UiCard soft className="ui-admin-section">
            <div className="ui-admin-subtitle">Run history</div>
            <div className="ui-admin-summary">
              Includes both <b>Active round check</b> runs and <b>Full parse</b> runs.
            </div>
            {runsMsg ? (
              <div className="ui-admin-summary">{runsMsg}</div>
            ) : (
              <UiTableShell style={{ marginTop: 12 }}>
                <UiTableScroll>
                  <table className="ui-table ui-table--compact" style={{ minWidth: 980 }}>
                    <thead>
                      <tr className="ui-table-head-row">
                        <UiTableHeadCell>Date/Time</UiTableHeadCell>
                        <UiTableHeadCell>Run type</UiTableHeadCell>
                        <UiTableHeadCell>Status</UiTableHeadCell>
                        <UiTableHeadCell>Updated scores</UiTableHeadCell>
                        <UiTableHeadCell>Leaderboard synced</UiTableHeadCell>
                        <UiTableHeadCell>Details</UiTableHeadCell>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => {
                        const updatedScores = run.sync_updated > 0;
                        const leaderboardSynced =
                          run.leaderboard_recalc_ran && run.leaderboard_recalc_ok === true;
                        const runType = runTypeLabel(
                          run,
                          run.scope === "full" ? "Full parse" : "Active round check"
                        );
                        const isOpen = openRunId === run.id;
                        return (
                          <tr key={run.id}>
                            <UiTableCell>{fmtMelbourne(run.started_at_utc)}</UiTableCell>
                            <UiTableCell>{runType}</UiTableCell>
                            <UiTableCell>{run.run_status === "success" ? "Success" : "Failed"}</UiTableCell>
                            <UiTableCell>{toYesNo(updatedScores)}</UiTableCell>
                            <UiTableCell>{toYesNo(leaderboardSynced)}</UiTableCell>
                            <UiTableCell>
                              <UiButton
                                onClick={() =>
                                  setOpenRunId((prev) => (prev === run.id ? null : run.id))
                                }
                                className="ui-admin-btn ui-admin-btn--compact"
                              >
                                {isOpen ? "Hide" : "View"}
                              </UiButton>
                              {isOpen && (
                                <div style={{ marginTop: 8 }}>
                                  <div className="ui-admin-summary ui-admin-summary--tight">
                                    Finished {fmtMelbourne(run.finished_at_utc)}.
                                  </div>
                                  <pre className="ui-admin-result-pre">
                                    {JSON.stringify(run.details, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </UiTableCell>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </UiTableScroll>
              </UiTableShell>
            )}
          </UiCard>
        </>
      )}
    </main>
  );
}
