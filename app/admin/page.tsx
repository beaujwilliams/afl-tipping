"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function AdminPage() {
  const router = useRouter();

  const [season, setSeason] = useState<number>(2026);
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const isRunning = loading !== null;

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
        }}
      >
        <div>
          <button
            disabled={isRunning}
            onClick={runSyncAndRecalc}
            style={{
              ...btnStyle,
              ...buttonStateStyle,
              background: "var(--foreground)",
              color: "var(--background)",
              border: "1px solid var(--foreground)",
              fontWeight: 800,
            }}
          >
            Sync Results + Recalculate Leaderboard
          </button>
          <div style={summaryStyle}>
            Pulls finished game winners from Squiggle, then updates leaderboard scores. If no new results are found, it skips recalculation.
          </div>
        </div>

        <div>
          <button
            disabled={isRunning}
            onClick={() => router.push("/admin/members")}
            style={{
              ...btnStyle,
              ...buttonStateStyle,
              background: "var(--card-soft)",
              color: "var(--foreground)",
              fontWeight: 800,
            }}
          >
            Manage Members
          </button>
          <div style={summaryStyle}>
            Opens member management so you can rename participants or remove people from the competition.
          </div>
        </div>

        <div style={{ marginTop: 4, fontSize: 13, fontWeight: 800, opacity: 0.7 }}>
          Other Admin Tools
        </div>

        <div>
          <button
            disabled={isRunning}
            onClick={() =>
              run(`/api/admin/snapshot-odds-all-due?season=${season}`)
            }
            style={{
              ...btnStyle,
              ...buttonStateStyle,
            }}
          >
            Snapshot Next Due Round
          </button>
          <div style={summaryStyle}>
            Captures odds for the next round when its snapshot window is due.
          </div>
        </div>

        <div>
          <button
            disabled={isRunning}
            onClick={() =>
              run(`/api/admin/snapshot-odds-all-due?season=${season}&force=1`)
            }
            style={{
              ...btnStyle,
              ...buttonStateStyle,
            }}
          >
            Force Snapshot (Testing)
          </button>
          <div style={summaryStyle}>
            Forces an odds snapshot immediately, even if it is not due yet. Use for testing or backfills.
          </div>
        </div>

        <div>
          <button
            disabled={isRunning}
            onClick={() =>
              run(`/api/admin/sync-results?season=${season}`)
            }
            style={{
              ...btnStyle,
              ...buttonStateStyle,
            }}
          >
            Sync Results (Squiggle)
          </button>
          <div style={summaryStyle}>
            Updates winners for finished matches only, without recalculating the leaderboard.
          </div>
        </div>

        <div>
          <button
            disabled={isRunning}
            onClick={() =>
              run(`/api/admin/recalc-leaderboard?season=${season}`)
            }
            style={{
              ...btnStyle,
              ...buttonStateStyle,
            }}
          >
            Recalculate Leaderboard
          </button>
          <div style={summaryStyle}>
            Recomputes leaderboard totals from current match results and stored odds snapshots.
          </div>
        </div>
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
