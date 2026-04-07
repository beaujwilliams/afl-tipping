"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useToast } from "@/components/ToastProvider";
import { UiButton, UiButtonLink, UiCard } from "@/components/ui";
import { NEXT_SEASON } from "@/lib/season-config";

type ConfirmAction = {
  title: string;
  body: string;
  confirmLabel: string;
  path: string;
};

type AutomationStatusCard = {
  title: string;
  detail: string;
};

const AUTOMATION_STATUS_CARDS: AutomationStatusCard[] = [
  {
    title: "Scoring refresh",
    detail: "Runs automatically after lock on a 5-minute cycle while unfinished matches still exist.",
  },
  {
    title: "Tip reminders",
    detail: "Run automatically before lock. Manual reminder sends stay in round tip lists, not here.",
  },
  {
    title: "Odds snapshots",
    detail: "Captured automatically when the next due round enters its snapshot window.",
  },
  {
    title: "Manual recovery",
    detail: "Still available, but pushed to Maintenance so it stays low-focus during normal weeks.",
  },
];

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
  if (value.includes("send-round-recap")) return "Generating and sending round recap...";
  return `Running: ${value}`;
}

export default function AdminPage() {
  const toast = useToast();
  const [season, setSeason] = useState<number>(2026);
  const [recapRound, setRecapRound] = useState<number>(1);
  const [recapToEmail, setRecapToEmail] = useState<string>("");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
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

  const resultSummary = useMemo(() => summarizeResult(result), [result]);
  const runningLabel = useMemo(() => describeRunningAction(loading), [loading]);

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
      toast.error("Enter an email for recap delivery.");
      return;
    }
    const round = Math.trunc(recapRound);
    if (!Number.isFinite(round) || round < 0) {
      setResult({ error: "Recap round must be 0 or higher." });
      toast.error("Recap round must be 0 or higher.");
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
      <div className="ui-page-header">
        <h1 className="ui-title">Admin Centre</h1>
        <div className="ui-caption">
          Automation now handles most of the routine work. This page keeps the common checks and
          actions simple, and tucks manual recovery tools away at the back.
        </div>
      </div>

      <div className="ui-admin-season-row">
        <label className="ui-admin-label">Season:</label>
        <input
          type="number"
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
          className="ui-input ui-admin-input-season"
        />
        <div className="ui-admin-summary ui-admin-summary--tight">
          Season-scoped logs, recaps, syncs, and snapshot actions use this value.
        </div>
      </div>

      <div className="ui-admin-grid">
        <UiCard soft className="ui-admin-section ui-admin-section--wide ui-admin-hero-card">
          <div className="ui-admin-overview-grid">
            <div className="ui-admin-stack-tight">
              <div className="ui-admin-kicker">Automation-first</div>
              <h2 className="ui-admin-hero-title">Step in only when the comp needs help.</h2>
              <div className="ui-admin-summary">
                The everyday jobs now run in the background. For most weeks, the only things you
                should need here are members, recap, and the scoring log.
              </div>
            </div>

            <div className="ui-admin-status-grid">
              {AUTOMATION_STATUS_CARDS.map((card) => (
                <div key={card.title} className="ui-admin-status-card">
                  <div className="ui-admin-status-title">{card.title}</div>
                  <div className="ui-admin-status-detail">{card.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </UiCard>

        <UiCard soft className="ui-admin-section">
          <h2 className="ui-admin-section-title">Members &amp; Settings</h2>
          <div className="ui-admin-summary">
            Payment state, unpaid tip lock, reigning champions, and next-season interest all live
            here.
          </div>

          <div className="ui-admin-two-col">
            <UiCard className="ui-admin-tool">
              <div className="ui-admin-subtitle">Members</div>
              <div className="ui-admin-summary ui-admin-summary--tight">
                Manage payment status, roles, test accounts, and season winner selections.
              </div>
              <UiButtonLink href="/admin/members" className="ui-admin-btn ui-admin-btn--full">
                Open Members
              </UiButtonLink>
            </UiCard>

            <UiCard className="ui-admin-tool">
              <div className="ui-admin-subtitle">Interested members</div>
              <div className="ui-admin-summary ui-admin-summary--tight">
                Review next-season registrations and send the season-open email when ready.
              </div>
              <UiButtonLink
                href="/admin/interested-members"
                className="ui-admin-btn ui-admin-btn--full"
              >
                Interested Members ({NEXT_SEASON})
              </UiButtonLink>
            </UiCard>
          </div>
        </UiCard>

        <UiCard soft className="ui-admin-section">
          <h2 className="ui-admin-section-title">Communications</h2>
          <div className="ui-admin-summary">
            Keep the one common manual comms action close: generate the round recap and send it to
            yourself.
          </div>

          <UiCard className="ui-admin-tool">
            <div className="ui-admin-subtitle">Round recap</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
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
              <div className="ui-admin-two-col">
                <UiButton
                  disabled={isRunning}
                  onClick={runRecapToMeNow}
                  className="ui-admin-btn ui-admin-btn--full"
                >
                  Generate Round Recap + Send To Me
                </UiButton>
                <UiButtonLink href="/admin/recaps" className="ui-admin-btn ui-admin-btn--full">
                  View Recap History
                </UiButtonLink>
              </div>
            </div>
          </UiCard>
        </UiCard>

        <UiCard soft className="ui-admin-section">
          <h2 className="ui-admin-section-title">Logs &amp; Visibility</h2>
          <div className="ui-admin-summary">
            If anything looks off, start here before reaching for a manual fix.
          </div>

          <UiCard className="ui-admin-tool">
            <div className="ui-admin-subtitle">Scoring run log</div>
            <div className="ui-admin-summary ui-admin-summary--tight">
              Check whether scoring ran, whether results changed, and whether the leaderboard refresh
              succeeded.
            </div>
            <UiButtonLink
              href={`/admin/scoring-sync?season=${encodeURIComponent(String(season))}`}
              className="ui-admin-btn ui-admin-btn--full"
            >
              Open Scoring Log
            </UiButtonLink>
          </UiCard>

          <div className="ui-admin-automation-list">
            <div className="ui-admin-automation-item">
              <div className="ui-admin-automation-title">What runs automatically now</div>
              <div className="ui-admin-summary ui-admin-summary--tight">
                Scoring checks, reminder sends, and due-round odds snapshots all run in the
                background. Manual tools are now just fallback options.
              </div>
            </div>
            <div className="ui-admin-automation-item">
              <div className="ui-admin-automation-title">Good first check when something feels off</div>
              <div className="ui-admin-summary ui-admin-summary--tight">
                Open the scoring log first, then only use Maintenance if the automation clearly missed
                something.
              </div>
            </div>
          </div>
        </UiCard>

        <details className="ui-card ui-card-soft ui-admin-section ui-admin-section--wide ui-admin-details">
          <summary className="ui-admin-details-summary">Maintenance &amp; Recovery</summary>
          <div className="ui-admin-summary">
            Low-use manual tools for recovery, backfills, or testing. They are still here, just kept
            out of the way so the admin centre stays calm during normal weeks.
          </div>

          <div className="ui-admin-maintenance-grid">
            <UiCard className="ui-admin-tool">
              <div className="ui-admin-subtitle">Fast recovery</div>
              <div className="ui-admin-summary ui-admin-summary--tight">
                Use the full recovery flow when results changed and you want to refresh everything in
                one go.
              </div>
              <UiButton
                disabled={isRunning}
                onClick={runSyncAndRecalc}
                className="ui-admin-btn ui-admin-btn--full ui-admin-btn--alt"
              >
                Sync Results + Recalculate Leaderboard
              </UiButton>
            </UiCard>

            <UiCard className="ui-admin-tool">
              <div className="ui-admin-subtitle">Manual scoring steps</div>
              <div className="ui-admin-summary ui-admin-summary--tight">
                Use individual scoring steps only when you need one part of the normal recovery flow.
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
              <div className="ui-admin-subtitle">Fixture &amp; odds maintenance</div>
              <div className="ui-admin-summary ui-admin-summary--tight">
                Use these for fixture backfills or when you need to manually trigger the standard odds
                capture path.
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
              </div>
            </UiCard>

            <UiCard className="ui-admin-tool">
              <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                <div className="ui-admin-subtitle">Testing / force snapshot</div>
                <span className="ui-admin-danger-chip">Rare use</span>
              </div>
              <div className="ui-admin-summary ui-admin-summary--tight">
                Forces odds capture immediately, even when not due. Keep this for testing and
                backfills only.
              </div>
              <UiButton
                disabled={isRunning}
                onClick={runForceSnapshotNow}
                className="ui-admin-btn ui-admin-btn--full"
                tone="dangerSoft"
              >
                Run Force Snapshot
              </UiButton>
            </UiCard>
          </div>

          <div className="ui-admin-maintenance-note">
            Normal path: let automation handle scoring, reminders, and snapshots, and only open this
            section when something genuinely needs manual help.
          </div>
        </details>
      </div>

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
