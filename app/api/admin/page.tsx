"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const CRON_SECRET = "q1w2e3r4t5y6u7i8o9p0";

type RunResult = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

export default function AdminPage() {
  const [season, setSeason] = useState<number>(2026);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Checking login…");
  const [running, setRunning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabaseBrowser.auth.getUser();
      if (!data.user) {
        window.location.href = "/login";
        return;
      }
      setUserEmail(data.user.email ?? "(no email)");
      setStatus("");
    })();
  }, []);

  const baseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  async function run(path: string) {
    setRunning(path);
    setLastResult(null);

    try {
      const fullUrl = `${baseUrl}${path}&secret=${CRON_SECRET}`;
      const res = await fetch(fullUrl, { method: "GET" });
      const text = await res.text();

      let json: RunResult;
      try {
        json = JSON.parse(text) as RunResult;
      } catch {
        json = { error: "Non-JSON response", bodyHead: text.slice(0, 500) };
      }

      setLastResult(json);
    } catch (e: unknown) {
      setLastResult({ error: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setRunning(null);
    }
  }

  async function runSyncAndRecalc() {
    setRunning("sync-and-recalc");
    setLastResult(null);

    try {
      const syncRes = await fetch(
        `${baseUrl}/api/admin/sync-results?season=${season}&secret=${CRON_SECRET}`,
        { method: "GET" }
      );
      const syncText = await syncRes.text();
      const syncJson = JSON.parse(syncText);

      if (!syncRes.ok) {
        setLastResult({
          ok: false,
          step: "sync-results",
          status: syncRes.status,
          result: syncJson,
        });
        return;
      }

      const syncUpdated =
        typeof syncJson === "object" &&
        syncJson !== null &&
        typeof (syncJson as Record<string, unknown>).updated === "number"
          ? ((syncJson as Record<string, unknown>).updated as number)
          : null;

      if (syncUpdated === 0) {
        setLastResult({
          ok: true,
          season,
          action: "sync-results-and-recalc-leaderboard",
          syncResults: syncJson,
          recalcSkipped: true,
          note: "Skipped recalculate leaderboard because sync-results.updated was 0.",
        });
        return;
      }

      const recalcRes = await fetch(
        `${baseUrl}/api/admin/recalc-leaderboard?season=${season}&secret=${CRON_SECRET}`,
        { method: "GET" }
      );
      const recalcText = await recalcRes.text();
      const recalcJson = JSON.parse(recalcText);

      setLastResult({
        ok: recalcRes.ok,
        season,
        action: "sync-results-and-recalc-leaderboard",
        syncResults: syncJson,
        recalcLeaderboard: recalcJson,
      });
    } catch (e: unknown) {
      setLastResult({ error: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setRunning(null);
    }
  }

  const btnStyle: React.CSSProperties = {
    width: "100%",
    padding: "16px",
    borderRadius: 14,
    border: "1px solid var(--border)",
    background: "var(--card)",
    color: "var(--foreground)",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 16,
    fontWeight: 600,
  };

  const smallStyle: React.CSSProperties = {
    fontSize: 12,
    opacity: 0.75,
    marginTop: 6,
  };

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1>Admin Tools</h1>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      {!status && (
        <>
          <div
            style={{
              marginTop: 12,
              padding: 16,
              border: "1px solid var(--border)",
              background: "var(--card-soft)",
              borderRadius: 14,
            }}
          >
            <div style={{ fontSize: 14, opacity: 0.7 }}>Signed in as</div>
            <div style={{ fontWeight: 700 }}>{userEmail}</div>

            <div style={{ marginTop: 12 }}>
              <label>
                <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
                  Season
                </div>
                <input
                  value={season}
                  onChange={(e) => setSeason(Number(e.target.value))}
                  type="number"
                  style={{
                    width: 120,
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                  }}
                />
              </label>
            </div>
          </div>

          <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
            <button
              style={{
                ...btnStyle,
                background: "var(--foreground)",
                color: "var(--background)",
                border: "1px solid var(--foreground)",
                fontWeight: 800,
              }}
              disabled={!!running}
              onClick={runSyncAndRecalc}
            >
              Sync Results + Recalculate Leaderboard
            </button>

            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() =>
                run(`/api/admin/snapshot-odds-all-due?season=${season}&force=1`)
              }
            >
              Snapshot Odds (ALL DUE - Force)
              <div style={smallStyle}>
                Captures Sportsbet decimal odds for rounds that are due.
              </div>
            </button>

            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() =>
                run(`/api/admin/sync-results?season=${season}`)
              }
            >
              Sync Results (Squiggle)
              <div style={smallStyle}>
                Updates winner_team for finished matches.
              </div>
            </button>

            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() =>
                run(`/api/admin/recalc-leaderboard?season=${season}`)
              }
            >
              Recalculate Leaderboard
              <div style={smallStyle}>
                Scores tips using your 12pm snapshot rule.
              </div>
            </button>
          </div>

          <div style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 18 }}>Last Result</h2>
            <pre
              style={{
                marginTop: 8,
                padding: 14,
                borderRadius: 14,
                border: "1px solid var(--border)",
                background: "var(--card-soft)",
                color: "var(--foreground)",
                overflow: "auto",
              }}
            >
              {lastResult
                ? JSON.stringify(lastResult, null, 2)
                : "No runs yet."}
            </pre>
          </div>
        </>
      )}
    </main>
  );
}
