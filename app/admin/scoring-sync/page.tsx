"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiButton, UiButtonLink, UiCard } from "@/components/ui";

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
    return "15-minute active round";
  }
  if (run.job_kind === "scoring_daily_full" || run.scope === "full") {
    return "Full parse";
  }
  return fallback;
}

export default function ScoringSyncLogPage() {
  const [season, setSeason] = useState<number>(2026);
  const [status, setStatus] = useState<string>("Checking login...");
  const [loading, setLoading] = useState<boolean>(false);
  const [fifteenRuns, setFifteenRuns] = useState<ScoringAutomationRun[]>([]);
  const [dailyRuns, setDailyRuns] = useState<ScoringAutomationRun[]>([]);
  const [fifteenMsg, setFifteenMsg] = useState<string>("Loading...");
  const [dailyMsg, setDailyMsg] = useState<string>("Loading...");

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

  async function loadRuns(jobKind: "scoring_15m" | "scoring_daily_full", token: string) {
    const res = await fetch(
      `/api/admin/scoring-automation-runs?season=${encodeURIComponent(
        String(season)
      )}&job_kind=${jobKind}&limit=40`,
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
      setFifteenMsg("Loading...");
      setDailyMsg("Loading...");

      const token = await getToken();
      if (!token) {
        setFifteenRuns([]);
        setDailyRuns([]);
        setFifteenMsg("Not authenticated.");
        setDailyMsg("Not authenticated.");
        return;
      }

      const [fifteen, daily] = await Promise.all([
        loadRuns("scoring_15m", token),
        loadRuns("scoring_daily_full", token),
      ]);

      if (!fifteen.ok || !fifteen.json?.ok) {
        const parts = [fifteen.json?.error ?? "Could not load 15-minute checks."];
        if (fifteen.json?.details) parts.push(fifteen.json.details);
        if (fifteen.json?.hint) parts.push(fifteen.json.hint);
        setFifteenRuns([]);
        setFifteenMsg(parts.join(" - "));
      } else {
        const rows = Array.isArray(fifteen.json.runs) ? fifteen.json.runs : [];
        setFifteenRuns(rows);
        setFifteenMsg(rows.length ? "" : "No 15-minute checks recorded yet.");
      }

      if (!daily.ok || !daily.json?.ok) {
        const parts = [daily.json?.error ?? "Could not load daily full-sync runs."];
        if (daily.json?.details) parts.push(daily.json.details);
        if (daily.json?.hint) parts.push(daily.json.hint);
        setDailyRuns([]);
        setDailyMsg(parts.join(" - "));
      } else {
        const rows = Array.isArray(daily.json.runs) ? daily.json.runs : [];
        setDailyRuns(rows);
        setDailyMsg(rows.length ? "" : "No daily full-sync runs recorded yet.");
      }
    } catch {
      setFifteenRuns([]);
      setDailyRuns([]);
      setFifteenMsg("Could not load 15-minute checks.");
      setDailyMsg("Could not load daily full-sync runs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status) return;
    void refreshLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, season]);

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
                    Date/time, run type, success/failed, updated scores (yes/no), and leaderboard sync (yes/no).
                  </div>
                </div>
              <div className="ui-row-wrap ui-admin-gap-sm">
                <input
                  type="number"
                  value={season}
                  onChange={(e) => setSeason(Number(e.target.value))}
                  className="ui-input ui-admin-input-season"
                />
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
            <div className="ui-admin-subtitle">15-minute active checks</div>
            <div className="ui-admin-summary">
              Runs every 15 minutes and checks locked rounds with unfinished matches.
            </div>
            {fifteenMsg ? (
              <div className="ui-admin-summary">{fifteenMsg}</div>
            ) : (
              <div className="ui-admin-stack">
                {fifteenRuns.map((run) => {
                  const updatedScores = run.sync_updated > 0;
                  const leaderboardSynced =
                    run.leaderboard_recalc_ran && run.leaderboard_recalc_ok === true;
                  const runType = runTypeLabel(run, "15-minute active round");
                  return (
                    <details key={run.id} className="ui-admin-tool ui-admin-tool--nested">
                      <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                        {fmtMelbourne(run.started_at_utc)} - {runType} - {run.run_status === "success" ? "Success" : "Failed"} - Updated scores {toYesNo(updatedScores)} - Leaderboard synced {toYesNo(leaderboardSynced)}
                      </summary>
                      <div className="ui-admin-summary ui-admin-summary--tight">
                        Finished {fmtMelbourne(run.finished_at_utc)}.
                      </div>
                      <pre className="ui-admin-result-pre">
                        {JSON.stringify(run.details, null, 2)}
                      </pre>
                    </details>
                  );
                })}
              </div>
            )}
          </UiCard>

          <UiCard soft className="ui-admin-section">
            <div className="ui-admin-subtitle">Daily full-season safety pass</div>
            <div className="ui-admin-summary">
              Runs once daily in full mode to catch late result corrections.
            </div>
            {dailyMsg ? (
              <div className="ui-admin-summary">{dailyMsg}</div>
            ) : (
              <div className="ui-admin-stack">
                {dailyRuns.map((run) => {
                  const updatedScores = run.sync_updated > 0;
                  const leaderboardSynced =
                    run.leaderboard_recalc_ran && run.leaderboard_recalc_ok === true;
                  const runType = runTypeLabel(run, "Full parse");
                  return (
                    <details key={run.id} className="ui-admin-tool ui-admin-tool--nested">
                      <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                        {fmtMelbourne(run.started_at_utc)} - {runType} - {run.run_status === "success" ? "Success" : "Failed"} - Updated scores {toYesNo(updatedScores)} - Leaderboard synced {toYesNo(leaderboardSynced)}
                      </summary>
                      <div className="ui-admin-summary ui-admin-summary--tight">
                        Finished {fmtMelbourne(run.finished_at_utc)}.
                      </div>
                      <pre className="ui-admin-result-pre">
                        {JSON.stringify(run.details, null, 2)}
                      </pre>
                    </details>
                  );
                })}
              </div>
            )}
          </UiCard>
        </>
      )}
    </main>
  );
}
