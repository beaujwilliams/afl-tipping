"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function AdminPage() {
  const router = useRouter();

  const [season, setSeason] = useState<number>(2026);
  const [reminderRound, setReminderRound] = useState<number>(1);
  const [recapRound, setRecapRound] = useState<number>(1);
  const [recapToEmail, setRecapToEmail] = useState<string>("");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState<string | null>(null);
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
          : null;

      if (syncUpdated === 0) {
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

  const buttonStateStyle: React.CSSProperties = {
    opacity: isRunning ? 0.6 : 1,
    cursor: isRunning ? "not-allowed" : "pointer",
  };

  const summaryStyle: React.CSSProperties = {
    fontSize: 13,
    opacity: 0.75,
    lineHeight: 1.4,
    marginTop: 6,
  };

  const primaryActionStyle: React.CSSProperties = {
    width: "100%",
    padding: "16px 18px",
    borderRadius: 12,
    fontSize: 17,
    boxShadow: "0 6px 16px rgba(0, 0, 0, 0.10)",
  };

  const secondaryActionStyle: React.CSSProperties = {
    width: "100%",
    padding: "15px 18px",
    borderRadius: 12,
    fontSize: 16,
  };

  const sectionCardStyle: React.CSSProperties = {
    padding: 14,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--card-soft)",
  };

  const sectionTitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 18,
  };

  const toolCardStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--card)",
  };

  const dangerBadgeStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 800,
    borderRadius: 999,
    padding: "2px 8px",
    border: "1px solid rgba(239,68,68,0.35)",
    background: "rgba(239,68,68,0.14)",
    color: "#991b1b",
    whiteSpace: "nowrap",
  };

  function runReminderWindow() {
    run(`/api/admin/send-prelock-reminders?season=${season}`);
  }

  function parseMinRound(value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.trunc(parsed));
  }

  function runReminderForRoundNow() {
    const round = Math.trunc(reminderRound);
    if (!Number.isFinite(round) || round < 0) {
      setResult({ error: "Reminder round must be 0 or higher." });
      return;
    }
    run(`/api/admin/send-prelock-reminders?season=${season}&round=${round}&force=1`);
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

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1>Admin Panel</h1>

      <div style={{ marginTop: 20 }}>
        <label style={{ fontWeight: 600 }}>Season:</label>
        <input
          type="number"
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
          style={{
            marginLeft: 10,
            padding: 8,
            borderRadius: 8,
            border: "1px solid var(--border)",
            width: 120,
          }}
        />
      </div>

      <div
        style={{
          marginTop: 30,
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        }}
      >
        <section style={{ ...sectionCardStyle, order: 4 }}>
          <h2 style={sectionTitleStyle}>Data Sync</h2>
          <div style={{ ...summaryStyle, marginTop: 8 }}>
            Keep rounds, fixtures and odds snapshots aligned for this season.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <div style={toolCardStyle}>
              <button
                disabled={isRunning}
                onClick={() => run(`/api/admin/sync-fixture?season=${season}`)}
                style={{ ...btnStyle, ...buttonStateStyle }}
              >
                Sync Fixture (Squiggle)
              </button>
              <div style={summaryStyle}>
                Imports or refreshes rounds and matches for this season.
              </div>
            </div>

            <div style={toolCardStyle}>
              <button
                disabled={isRunning}
                onClick={() => run(`/api/admin/snapshot-odds-all-due?season=${season}`)}
                style={{ ...btnStyle, ...buttonStateStyle }}
              >
                Snapshot Next Due Round
              </button>
              <div style={summaryStyle}>
                Captures odds for the next round only when its snapshot window is due.
              </div>
            </div>

            <div style={toolCardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <div style={{ fontWeight: 700 }}>Force Snapshot (Testing)</div>
                <span style={dangerBadgeStyle}>Force</span>
              </div>
              <button
                disabled={isRunning}
                onClick={() => run(`/api/admin/snapshot-odds-all-due?season=${season}&force=1`)}
                style={{ ...btnStyle, ...buttonStateStyle, marginTop: 8 }}
              >
                Run Force Snapshot
              </button>
              <div style={summaryStyle}>
                Forces odds capture immediately, even when not due. Use for testing/backfills only.
              </div>
            </div>
          </div>
        </section>

        <section style={{ ...sectionCardStyle, order: 2 }}>
          <h2 style={sectionTitleStyle}>Comms</h2>
          <div style={{ ...summaryStyle, marginTop: 8 }}>
            Send reminder/recap emails and manage recap history.
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              disabled={isRunning}
              onClick={() => router.push("/admin/recaps")}
              style={{
                ...btnStyle,
                ...secondaryActionStyle,
                ...buttonStateStyle,
                background: "var(--card-soft)",
                color: "var(--foreground)",
                border: "1px solid var(--foreground)",
                fontWeight: 800,
              }}
            >
              Round Recaps
            </button>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <div style={toolCardStyle}>
              <div style={{ fontWeight: 800 }}>Tip reminders</div>
              <div style={summaryStyle}>
                Send reminders in the normal 3h window or force-send for a specific round.
              </div>
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                <button
                  disabled={isRunning}
                  onClick={runReminderWindow}
                  style={{ ...btnStyle, ...buttonStateStyle }}
                >
                  Send Tip Reminders (3h Window)
                </button>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ fontWeight: 600 }}>Round</label>
                  <input
                    type="number"
                    min={0}
                    value={reminderRound}
                    onChange={(e) => setReminderRound(parseMinRound(e.target.value))}
                    onBlur={() => setReminderRound((prev) => Math.max(0, Math.trunc(prev)))}
                    style={{
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      width: 96,
                    }}
                  />
                  <button
                    disabled={isRunning}
                    onClick={runReminderForRoundNow}
                    style={{ ...btnStyle, ...buttonStateStyle }}
                  >
                    Send Tip Reminders Now
                  </button>
                  <span style={dangerBadgeStyle}>Force</span>
                </div>
              </div>
            </div>

            <div style={toolCardStyle}>
              <div style={{ fontWeight: 800 }}>Round recap</div>
              <div style={summaryStyle}>
                Generate a round recap now and email it directly to you.
              </div>
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ fontWeight: 600 }}>Round</label>
                  <input
                    type="number"
                    min={0}
                    value={recapRound}
                    onChange={(e) => setRecapRound(parseMinRound(e.target.value))}
                    onBlur={() => setRecapRound((prev) => Math.max(0, Math.trunc(prev)))}
                    style={{
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      width: 96,
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ fontWeight: 600, minWidth: 66 }}>Send to</label>
                  <input
                    type="email"
                    value={recapToEmail}
                    onChange={(e) => setRecapToEmail(e.target.value)}
                    placeholder="you@example.com"
                    style={{
                      flex: "1 1 260px",
                      minWidth: 220,
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                    }}
                  />
                </div>
                <button
                  disabled={isRunning}
                  onClick={runRecapToMeNow}
                  style={{ ...btnStyle, ...buttonStateStyle }}
                >
                  Generate Round Recap + Send To Me
                </button>
              </div>
            </div>
          </div>
        </section>

        <section style={{ ...sectionCardStyle, order: 3 }}>
          <h2 style={sectionTitleStyle}>Members</h2>
          <div style={{ ...summaryStyle, marginTop: 8 }}>
            Manage members, payment states, unpaid tip lock and seasonal settings.
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              disabled={isRunning}
              onClick={() => router.push("/admin/members")}
              style={{
                ...btnStyle,
                ...secondaryActionStyle,
                ...buttonStateStyle,
                background: "var(--card-soft)",
                color: "var(--foreground)",
                border: "1px solid var(--foreground)",
                fontWeight: 800,
              }}
            >
              Manage Members
            </button>
          </div>
        </section>

        <section style={{ ...sectionCardStyle, order: 1 }}>
          <h2 style={sectionTitleStyle}>Scoring</h2>
          <div style={{ ...summaryStyle, marginTop: 8 }}>
            Update finished game results and refresh season totals.
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <button
              disabled={isRunning}
              onClick={runSyncAndRecalc}
              style={{
                ...btnStyle,
                ...primaryActionStyle,
                ...buttonStateStyle,
                background: "var(--foreground)",
                color: "var(--background)",
                border: "1px solid var(--foreground)",
                fontWeight: 800,
              }}
            >
              Sync Results + Recalculate Leaderboard
            </button>

            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <button
                disabled={isRunning}
                onClick={() => run(`/api/admin/sync-results?season=${season}`)}
                style={{ ...btnStyle, ...buttonStateStyle }}
              >
                Sync Results (Only)
              </button>

              <button
                disabled={isRunning}
                onClick={() => run(`/api/admin/recalc-leaderboard?season=${season}`)}
                style={{ ...btnStyle, ...buttonStateStyle }}
              >
                Recalculate Leaderboard (Only)
              </button>
            </div>
          </div>
        </section>
      </div>

      {result !== null && (
        <div
          style={{
            marginTop: 30,
            padding: 16,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--card-soft)",
            color: "var(--foreground)",
            fontSize: 13,
            overflowX: "auto",
          }}
        >
          <b>Last Result</b>
          <pre style={{ marginTop: 10 }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      {loading && (
        <div style={{ marginTop: 20, opacity: 0.7 }}>
          Running: {loading}
        </div>
      )}
    </main>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--foreground)",
  fontWeight: 600,
  cursor: "pointer",
};
