"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiBadge, UiButton, UiButtonLink, UiCard } from "@/components/ui";

type ConfirmAction = {
  title: string;
  body: string;
  confirmLabel: string;
  path: string;
};

type RoundStatusPlayer = {
  user_id: string;
  display_name: string | null;
};

type TipStatusRound = {
  round_id: string;
  round_number: number;
  lock_time_utc: string | null;
  total_players: number;
  tipped_players: number;
  missing_count: number;
  missing_players?: RoundStatusPlayer[];
};

type TipStatusResponse = {
  ok?: boolean;
  error?: string;
  admin?: boolean;
  rounds?: TipStatusRound[];
};

function fmtMelbourneShort(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
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
  const [commandCenterRounds, setCommandCenterRounds] = useState<TipStatusRound[]>([]);
  const [commandCenterMsg, setCommandCenterMsg] = useState<string>("Loading rounds…");
  const [commandCenterLoading, setCommandCenterLoading] = useState<boolean>(false);
  const [openMissingRoundId, setOpenMissingRoundId] = useState<string | null>(null);
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
    void loadRoundCommandCenter(season);
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

  async function loadRoundCommandCenter(targetSeason: number) {
    try {
      setCommandCenterLoading(true);
      setCommandCenterMsg("Loading rounds…");

      const token = await getToken();
      if (!token) {
        setCommandCenterRounds([]);
        setCommandCenterMsg("Not authenticated.");
        return;
      }

      const res = await fetch(
        `/api/round-tip-status?season=${encodeURIComponent(String(targetSeason))}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );
      const json = (await res.json().catch(() => null)) as TipStatusResponse | null;

      if (!res.ok || !json?.ok) {
        setCommandCenterRounds([]);
        setCommandCenterMsg(json?.error ?? "Could not load command center rounds.");
        return;
      }

      if (!json.admin) {
        setCommandCenterRounds([]);
        setCommandCenterMsg("Admin access required.");
        return;
      }

      const rows = [...(json.rounds ?? [])].sort((a, b) => a.round_number - b.round_number);
      setCommandCenterRounds(rows);
      setCommandCenterMsg(rows.length ? "" : "No rounds found.");
      setOpenMissingRoundId((prev) =>
        prev && rows.some((r) => r.round_id === prev) ? prev : null
      );
    } catch {
      setCommandCenterRounds([]);
      setCommandCenterMsg("Could not load command center rounds.");
    } finally {
      setCommandCenterLoading(false);
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

  function openForceReminderConfirm(round: number) {
    setConfirmAction({
      title: "Force-send tip reminders?",
      body: `This will send reminder emails now for round ${round}, ignoring the normal 3-hour window.`,
      confirmLabel: "Yes, send reminders now",
      path: `/api/admin/send-prelock-reminders?season=${season}&round=${round}&force=1`,
    });
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

  function openPaymentReminderConfirm() {
    setConfirmAction({
      title: "Send payment reminders now?",
      body: "This will email pending members who have not already been sent this reminder this season.",
      confirmLabel: "Yes, send payment reminders",
      path: `/api/admin/send-payment-reminders?season=${season}`,
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
    if (path.includes("/api/admin/send-prelock-reminders")) {
      await loadRoundCommandCenter(season);
    }
  }

  const currentCommandRound = (() => {
    if (commandCenterRounds.length === 0) return null;
    const nextOpen = commandCenterRounds.find((round) => {
      if (!round.lock_time_utc) return false;
      const lockMs = new Date(round.lock_time_utc).getTime();
      return Number.isFinite(lockMs) && Date.now() < lockMs;
    });
    return nextOpen ?? commandCenterRounds[commandCenterRounds.length - 1] ?? null;
  })();

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
          <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 10 }}>
            <h2 className="ui-admin-section-title">Round Command Center</h2>
            <UiButton
              disabled={isRunning || commandCenterLoading}
              onClick={() => loadRoundCommandCenter(season)}
              className="ui-admin-btn"
            >
              {commandCenterLoading ? "Refreshing…" : "Refresh"}
            </UiButton>
          </div>
          <div className="ui-admin-summary">
            Quick actions by round: open round, see who is missing tips, and send reminders.
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

          {commandCenterMsg ? (
            <div className="ui-admin-summary">{commandCenterMsg}</div>
          ) : (
            <div className="ui-admin-stack">
              {currentCommandRound ? (
                (() => {
                  const round = currentCommandRound;
                  const lockMs = round.lock_time_utc ? new Date(round.lock_time_utc).getTime() : null;
                  const isLocked = lockMs !== null && Date.now() >= lockMs;
                  const missing = round.missing_players ?? [];
                  const isOpen = openMissingRoundId === round.round_id;

                  return (
                    <UiCard key={round.round_id} className="ui-admin-tool">
                    <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                      <div className="ui-admin-command-summary">
                        Locks {fmtMelbourneShort(round.lock_time_utc)} • Tipped {round.tipped_players}/
                        {round.total_players} • Missing {round.missing_count}
                      </div>
                      <UiBadge tone={isLocked ? "locked" : "open"}>
                        {isLocked ? "LOCKED" : "OPEN"}
                      </UiBadge>
                    </div>

                    <div className="ui-row-wrap ui-admin-gap-sm" style={{ marginTop: 10 }}>
                      <UiButtonLink
                        href={`/round/${season}/${round.round_number}`}
                        className="ui-admin-btn"
                        pill
                      >
                        Open round
                      </UiButtonLink>
                      <UiButton
                        type="button"
                        onClick={() =>
                          setOpenMissingRoundId((prev) => (prev === round.round_id ? null : round.round_id))
                        }
                        className="ui-admin-btn"
                        pill
                      >
                        {isOpen ? "Hide missing" : `Who is missing (${round.missing_count})`}
                      </UiButton>
                      <UiButton
                        type="button"
                        disabled={isRunning || round.missing_count === 0}
                        onClick={() => openForceReminderConfirm(round.round_number)}
                        className="ui-admin-btn"
                        tone="dangerSoft"
                        pill
                      >
                        Send reminder
                      </UiButton>
                    </div>

                    {isOpen && (
                      <div className="ui-admin-missing-list">
                        {missing.length === 0 ? (
                          <div className="ui-admin-summary">Everyone has tipped this round.</div>
                        ) : (
                          missing.map((p) => (
                            <div key={p.user_id} className="ui-admin-missing-item">
                              {p.display_name?.trim() || "(no display name)"}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                    </UiCard>
                  );
                })()
              ) : (
                <div className="ui-admin-summary">No current round available.</div>
              )}
            </div>
          )}
        </UiCard>

        <UiCard soft className="ui-admin-section" style={{ order: 1 }}>
          <h2 className="ui-admin-section-title">Members</h2>
          <div className="ui-admin-summary">
            Manage members, payment states, unpaid tip lock and seasonal settings.
          </div>

          <div className="ui-admin-stack">
            <UiButtonLink href="/admin/members" className="ui-admin-btn ui-admin-btn--full ui-admin-btn--alt">
              Manage Members
            </UiButtonLink>
          </div>
        </UiCard>

        <UiCard soft className="ui-admin-section" style={{ order: 2 }}>
          <h2 className="ui-admin-section-title">Comms</h2>
          <div className="ui-admin-summary">
            Send reminder, payment, and recap emails.
          </div>

          <div className="ui-admin-stack">
            <UiCard className="ui-admin-tool">
              <div className="ui-admin-subtitle">Tip reminders (automated)</div>
              <div className="ui-admin-summary">
                Runs automatically every 30 minutes and only sends in the configured 3-hour pre-lock window.
              </div>
              <div className="ui-admin-summary">
                Manual override is available in the Round Command Center via <b>Send reminder</b>.
              </div>
            </UiCard>

            <UiCard className="ui-admin-tool">
              <div className="ui-admin-subtitle">Payment reminders (manual)</div>
              <div className="ui-admin-summary">
                Send payment reminder emails to members with payment status <b>pending</b>.
              </div>
              <UiButton
                disabled={isRunning}
                onClick={openPaymentReminderConfirm}
                className="ui-admin-btn ui-admin-btn--full"
                style={{ marginTop: 10 }}
              >
                Send Payment Pending Reminders
              </UiButton>
            </UiCard>

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
            Infrequent tools for manual scoring checks, fixture refreshes, and odds snapshot maintenance.
          </div>

          <div className="ui-admin-two-col ui-admin-stack">
            <UiCard className="ui-admin-tool">
              <div className="ui-admin-subtitle">Manual scoring tools</div>
              <div className="ui-admin-summary">
                Use these only when you need to run part of the normal sync flow on its own.
              </div>
              <div className="ui-admin-two-col">
                <UiButton
                  disabled={isRunning}
                  onClick={() => run(`/api/admin/sync-results?season=${season}`)}
                  className="ui-admin-btn ui-admin-btn--full ui-admin-btn--wrap"
                >
                  Sync Results (Only)
                </UiButton>

                <UiButton
                  disabled={isRunning}
                  onClick={() => run(`/api/admin/recalc-leaderboard?season=${season}`)}
                  className="ui-admin-btn ui-admin-btn--full ui-admin-btn--wrap"
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
