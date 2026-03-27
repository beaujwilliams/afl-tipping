"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiButton, UiButtonLink, UiCard } from "@/components/ui";
import { NEXT_SEASON } from "@/lib/season-config";

type ConfirmAction = {
  title: string;
  body: string;
  confirmLabel: string;
  path: string;
};

type ScoringAutomationRun = {
  id: string;
  job_kind: string;
  scope: "active" | "full";
  run_status: "success" | "failed";
  sync_ok: boolean;
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

function fmtMelbourneShort(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function AdminPage() {
  const [season, setSeason] = useState<number>(2026);
  const [recapRound, setRecapRound] = useState<number>(1);
  const [recapToEmail, setRecapToEmail] = useState<string>("");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [scoringRuns, setScoringRuns] = useState<ScoringAutomationRun[]>([]);
  const [scoringRunsLoading, setScoringRunsLoading] = useState<boolean>(false);
  const [scoringRunsMsg, setScoringRunsMsg] = useState<string>("Loading recent 15-minute checks...");
  const isRunning = loading !== null;

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabaseBrowser.auth.getUser();
      if (!alive) return;
      const email = String(data.user?.email ?? "").trim();
      if (email) setRecapToEmail(email);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void loadScoringRunLogs(season);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

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

  async function loadScoringRunLogs(targetSeason: number) {
    try {
      setScoringRunsLoading(true);
      setScoringRunsMsg("Loading recent 15-minute checks...");

      const token = await getToken();
      if (!token) {
        setScoringRuns([]);
        setScoringRunsMsg("Not authenticated.");
        return;
      }

      const res = await fetch(
        `/api/admin/scoring-automation-runs?season=${encodeURIComponent(
          String(targetSeason)
        )}&job_kind=scoring_15m&limit=25`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const json = (await res.json().catch(() => null)) as ScoringRunsResponse | null;
      if (!res.ok || !json?.ok) {
        const parts = [json?.error ?? "Could not load scoring run log."];
        if (json?.details) parts.push(json.details);
        if (json?.hint) parts.push(json.hint);
        setScoringRuns([]);
        setScoringRunsMsg(parts.join(" - "));
        return;
      }

      const rows = Array.isArray(json.runs) ? json.runs : [];
      setScoringRuns(rows);
      setScoringRunsMsg(rows.length ? "" : "No 15-minute checks recorded yet.");
    } catch {
      setScoringRuns([]);
      setScoringRunsMsg("Could not load scoring run log.");
    } finally {
      setScoringRunsLoading(false);
    }
  }

  async function run(path: string) {
    try {
      setLoading(path);
      setResult(null);

      const token = await getToken();

      if (!token) {
        setResult({ error: "Not authenticated." });
        return;
      }

      const { json } = await callAdmin(path, token);
      setResult(json);
    } catch (err: unknown) {
      setResult({ error: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setLoading(null);
    }
  }

  async function runSyncAndRecalc() {
    try {
      setLoading("sync-and-recalc");
      setResult(null);

      const token = await getToken();
      if (!token) {
        setResult({ error: "Not authenticated." });
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
        return;
      }

      const recalc = await callAdmin(`/api/admin/recalc-leaderboard?season=${season}`, token);
      setResult({
        ok: recalc.ok,
        season,
        action: "sync-results-and-recalc-leaderboard",
        syncResults: sync.json,
        recalcLeaderboard: recalc.json,
      });
    } catch (err: unknown) {
      setResult({ error: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setLoading(null);
    }
  }

  function parseMinRound(value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.trunc(parsed));
  }

  function runRecapToMeNow() {
    const toEmail = recapToEmail.trim();
    if (!toEmail) {
      setResult({ error: "Enter an email for recap delivery." });
      return;
    }
    const round = Math.trunc(recapRound);
    if (!Number.isFinite(round) || round < 0) {
      setResult({ error: "Recap round must be 0 or higher." });
      return;
    }
    run(
      `/api/admin/send-round-recap?season=${season}&round=${round}&force=1&to_email=${encodeURIComponent(
        toEmail
      )}`
    );
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

  return (
    <main className="ui-page ui-page--narrow ui-admin-page">
      <h1 className="ui-title">Admin Panel</h1>

      <div className="ui-admin-season-row">
        <label className="ui-admin-label">Season:</label>
        <input
          type="number"
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
          className="ui-input ui-admin-input-season"
        />
      </div>

      <div className="ui-admin-grid">
        <UiCard soft className="ui-admin-section ui-admin-section--wide" style={{ order: 0 }}>
          <h2 className="ui-admin-section-title">Round Command Center</h2>
          <div className="ui-admin-summary">
            Main in-season action for updating finished results and refreshing the leaderboard.
          </div>

          <div className="ui-admin-stack">
            <UiButton
              disabled={isRunning}
              onClick={runSyncAndRecalc}
              className="ui-admin-btn ui-admin-btn--full ui-admin-btn--primary"
            >
              Sync Results + Recalculate Leaderboard
            </UiButton>
          </div>
        </UiCard>

        <UiCard soft className="ui-admin-section" style={{ order: 1 }}>
          <h2 className="ui-admin-section-title">Members</h2>
          <div className="ui-admin-summary">
            Manage members, payment states, unpaid tip lock and seasonal settings.
          </div>

          <div className="ui-admin-stack">
            <UiCard className="ui-admin-tool">
              <UiButtonLink href="/admin/members" className="ui-admin-btn ui-admin-btn--full">
                Manage Members
              </UiButtonLink>
            </UiCard>

            <UiCard className="ui-admin-tool">
              <UiButtonLink href="/admin/interested-members" className="ui-admin-btn ui-admin-btn--full">
                Interested Members ({NEXT_SEASON})
              </UiButtonLink>
            </UiCard>
          </div>
        </UiCard>

        <UiCard soft className="ui-admin-section" style={{ order: 2 }}>
          <h2 className="ui-admin-section-title">Comms</h2>
          <div className="ui-admin-stack">
            <UiCard className="ui-admin-tool">
              <div className="ui-admin-subtitle">Round recap</div>
              <div className="ui-admin-summary">
                Generate a round recap now and email it directly to you.
              </div>
              <div className="ui-admin-stack">
                <div className="ui-row-wrap ui-admin-gap-sm ui-admin-form-row">
                  <label className="ui-admin-label">Round</label>
                  <input
                    type="number"
                    min={0}
                    value={recapRound}
                    onChange={(e) => setRecapRound(parseMinRound(e.target.value))}
                    onBlur={() => setRecapRound((prev) => Math.max(0, Math.trunc(prev)))}
                    className="ui-input ui-admin-input-round"
                  />
                </div>
                <div className="ui-row-wrap ui-admin-gap-sm ui-admin-form-row">
                  <label className="ui-admin-label ui-admin-label-email">Send to</label>
                  <input
                    type="email"
                    value={recapToEmail}
                    onChange={(e) => setRecapToEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="ui-input ui-admin-input-email"
                  />
                </div>
                <UiButton
                  disabled={isRunning}
                  onClick={runRecapToMeNow}
                  className="ui-admin-btn ui-admin-btn--full"
                >
                  Generate Round Recap + Send To Me
                </UiButton>
              </div>
            </UiCard>
          </div>
        </UiCard>

        <details className="ui-card ui-card-soft ui-admin-section ui-admin-section--wide ui-admin-details" style={{ order: 3 }}>
          <summary className="ui-admin-details-summary">Advanced / Maintenance</summary>
          <div className="ui-admin-summary">
            Infrequent tools plus a reference for the background automation and time-based rules running across the site.
          </div>

          <div className="ui-admin-stack">
            <UiCard className="ui-admin-tool">
              <div className="ui-admin-subtitle">Automated messaging / site jobs</div>
              <div className="ui-admin-summary">
                What runs automatically across the site today.
              </div>

              <div className="ui-admin-automation-list">
                <div className="ui-admin-automation-item">
                  <div className="ui-admin-automation-title">Scoring sync + leaderboard refresh</div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    GitHub Actions runs every <b>15 minutes</b> and calls scoring automation in <code>active</code> mode (locked rounds with unfinished matches only).
                  </div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    A second GitHub Actions pass runs <b>once daily</b> in <code>full</code> mode as a season-wide safety sync.
                  </div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    Leaderboard recalc is only triggered when sync detects updates (<code>updated &gt; 0</code>).
                  </div>
                </div>

                <div className="ui-admin-automation-item">
                  <div className="ui-admin-automation-title">Tip reminders</div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    GitHub Actions runs every 30 minutes and only sends in the configured 3-hour pre-lock window.
                  </div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    Manual override is available in <b>Tip lists</b> for the current open round via <b>Send reminders now</b>.
                  </div>
                </div>

                <div className="ui-admin-automation-item">
                  <div className="ui-admin-automation-title">Odds snapshot capture</div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    GitHub Actions runs every 10 minutes and calls the due-round snapshot endpoint.
                  </div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    The endpoint only captures odds when a round is due, which is 36 hours before lock.
                  </div>
                </div>

                <div className="ui-admin-automation-item">
                  <div className="ui-admin-automation-title">Round locking</div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    No scheduled job is needed. Rounds lock automatically when the current time passes <code>lock_time_utc</code>.
                  </div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    That same lock time controls when results, tip breakdowns, and everyone&apos;s tips become visible.
                  </div>
                </div>

                <div className="ui-admin-automation-item">
                  <div className="ui-admin-automation-title">Unpaid tip lock</div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    If enabled in Members settings, members with payment status <b>pending</b> are blocked from tip submission automatically.
                  </div>
                  <div className="ui-admin-summary ui-admin-summary--tight">
                    Login, chat, and results stay available while the payment lock is active.
                  </div>
                </div>
              </div>

              <div className="ui-admin-tool ui-admin-tool--nested">
                <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                  <div className="ui-admin-subtitle">Recent 15-minute scoring checks</div>
                  <UiButton
                    disabled={isRunning || scoringRunsLoading}
                    onClick={() => void loadScoringRunLogs(season)}
                    className="ui-admin-btn ui-admin-btn--compact"
                  >
                    {scoringRunsLoading ? "Refreshing..." : "Refresh log"}
                  </UiButton>
                </div>

                {scoringRunsMsg && (
                  <div className="ui-admin-summary">{scoringRunsMsg}</div>
                )}

                {scoringRuns.length > 0 && (
                  <div className="ui-admin-stack">
                    {scoringRuns.map((run) => {
                      const updatedScores = run.sync_updated > 0;
                      const leaderboardSynced = run.leaderboard_recalc_ran && run.leaderboard_recalc_ok === true;
                      return (
                        <details key={run.id} className="ui-admin-tool ui-admin-tool--nested">
                          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                            {fmtMelbourneShort(run.started_at_utc)} - {run.run_status === "success" ? "Success" : "Failed"} - Updated scores {updatedScores ? "Yes" : "No"} - Leaderboard synced {leaderboardSynced ? "Yes" : "No"}
                          </summary>
                          <div className="ui-admin-summary ui-admin-summary--tight">
                            Finished {fmtMelbourneShort(run.finished_at_utc)}.
                          </div>
                          <pre className="ui-admin-result-pre">
                            {JSON.stringify(run.details, null, 2)}
                          </pre>
                        </details>
                      );
                    })}
                  </div>
                )}
              </div>
            </UiCard>

            <div className="ui-admin-maintenance-grid">
              <UiCard className="ui-admin-tool">
                <div className="ui-admin-subtitle">Manual scoring tools</div>
                <div className="ui-admin-summary">
                  Use these only when you need to run part of the normal sync flow on its own.
                </div>
                <div className="ui-row-wrap ui-admin-gap-sm">
                  <UiButton
                    disabled={isRunning}
                    onClick={() => run(`/api/admin/sync-results?season=${season}`)}
                    className="ui-admin-btn ui-admin-btn--compact"
                  >
                    Sync Results (Only)
                  </UiButton>

                  <UiButton
                    disabled={isRunning}
                    onClick={() => run(`/api/admin/recalc-leaderboard?season=${season}`)}
                    className="ui-admin-btn ui-admin-btn--compact"
                  >
                    Recalculate Leaderboard (Only)
                  </UiButton>
                </div>
              </UiCard>

              <UiCard className="ui-admin-tool">
                <div className="ui-admin-subtitle">Data sync</div>
                <div className="ui-admin-summary">
                  Keep rounds, fixtures and odds snapshots aligned for this season.
                </div>

                <div className="ui-admin-stack">
                  <UiButton
                    disabled={isRunning}
                    onClick={() => run(`/api/admin/sync-fixture?season=${season}`)}
                    className="ui-admin-btn ui-admin-btn--full"
                  >
                    Sync Fixture (Squiggle)
                  </UiButton>

                  <UiButton
                    disabled={isRunning}
                    onClick={() => run(`/api/admin/snapshot-odds-all-due?season=${season}`)}
                    className="ui-admin-btn ui-admin-btn--full"
                  >
                    Snapshot Next Due Round
                  </UiButton>

                  <div className="ui-admin-tool ui-admin-tool--nested">
                    <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                      <div className="ui-admin-subtitle">Force Snapshot (Testing)</div>
                      <span className="ui-admin-danger-chip">Force</span>
                    </div>
                    <UiButton
                      disabled={isRunning}
                      onClick={runForceSnapshotNow}
                      className="ui-admin-btn ui-admin-btn--full"
                    >
                      Run Force Snapshot
                    </UiButton>
                    <div className="ui-admin-summary">
                      Forces odds capture immediately, even when not due. Use for testing/backfills only.
                    </div>
                  </div>
                </div>
              </UiCard>
            </div>
          </div>
        </details>
      </div>

      {result !== null && (
        <UiCard soft className="ui-admin-result">
          <b>Last Result</b>
          <pre className="ui-admin-result-pre">
            {JSON.stringify(result, null, 2)}
          </pre>
        </UiCard>
      )}

      {loading && (
        <div className="ui-admin-running">
          Running: {loading}
        </div>
      )}

      {confirmAction && (
        <div onClick={closeConfirm} className="ui-admin-modal-backdrop">
          <UiCard onClick={(e) => e.stopPropagation()} className="ui-admin-modal">
            <div className="ui-admin-modal-title">{confirmAction.title}</div>
            <div className="ui-admin-modal-body">{confirmAction.body}</div>
            <div className="ui-admin-modal-actions">
              <UiButton
                disabled={isRunning}
                onClick={closeConfirm}
                className="ui-admin-btn"
              >
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
