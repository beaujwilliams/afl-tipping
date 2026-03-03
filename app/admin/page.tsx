"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

const btnStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "16px",
  marginBottom: "16px",
  borderRadius: "8px",
  border: "1px solid #ddd",
  background: "#f9f9f9",
  textAlign: "left",
  cursor: "pointer",
  fontSize: "16px",
};

const smallStyle: React.CSSProperties = {
  fontSize: "13px",
  opacity: 0.6,
  marginTop: "4px",
};

export default function AdminPage() {
  const [season, setSeason] = useState(2026);
  const [round, setRound] = useState(1);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function run(path: string) {
    setRunning(path);
    setResult(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const headers: Record<string, string> = {};

    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    // If using Vercel protection bypass
    if (process.env.NEXT_PUBLIC_VERCEL_BYPASS_SECRET) {
      headers["x-vercel-protection-bypass"] =
        process.env.NEXT_PUBLIC_VERCEL_BYPASS_SECRET;
    }

    try {
      const res = await fetch(path, { headers });
      const text = await res.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: "Non-JSON response", status: res.status, body: text };
      }

      setResult(json);
    } catch (err: any) {
      setResult({ error: err.message });
    }

    setRunning(null);
  }

  return (
    <div style={{ maxWidth: 800, margin: "40px auto" }}>
      <h1>Admin Tools</h1>

      <div style={{ marginBottom: 24 }}>
        <label>
          Season:{" "}
          <input
            type="number"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
          />
        </label>
      </div>

      {/* 🚀 Full Automation */}
      <button
        style={btnStyle}
        disabled={!!running}
        onClick={() => run(`/api/admin/run-automation?season=${season}`)}
      >
        🚀 Run Automation (Snapshot → Sync → Recalc)
        <div style={smallStyle}>
          Runs next due snapshot, syncs results, then recalculates leaderboard.
        </div>
      </button>

      {/* Snapshot Next Due */}
      <button
        style={btnStyle}
        disabled={!!running}
        onClick={() =>
          run(`/api/admin/snapshot-odds-all-due?season=${season}&limit=1`)
        }
      >
        Snapshot Next Due Round
        <div style={smallStyle}>
          Snapshots only the next round that is due.
        </div>
      </button>

      {/* Force Snapshot */}
      <button
        style={btnStyle}
        disabled={!!running}
        onClick={() =>
          run(
            `/api/admin/snapshot-odds-all-due?season=${season}&force=1`
          )
        }
      >
        Force Snapshot (Testing)
        <div style={smallStyle}>
          Forces snapshot for all due rounds (testing only).
        </div>
      </button>

      {/* Snapshot Specific Round */}
      <div style={{ marginBottom: 12 }}>
        <label>
          Round:{" "}
          <input
            type="number"
            value={round}
            onChange={(e) => setRound(Number(e.target.value))}
          />
        </label>
      </div>

      <button
        style={btnStyle}
        disabled={!!running}
        onClick={() =>
          run(
            `/api/admin/snapshot-odds-all-due?season=${season}&round=${round}&force=1`
          )
        }
      >
        Snapshot Specific Round
        <div style={smallStyle}>
          Snapshots only the specified round.
        </div>
      </button>

      {/* Sync Results */}
      <button
        style={btnStyle}
        disabled={!!running}
        onClick={() =>
          run(`/api/admin/sync-results?season=${season}`)
        }
      >
        Sync Results
        <div style={smallStyle}>
          Pulls completed games from Squiggle and updates matches.
        </div>
      </button>

      {/* Recalculate Leaderboard */}
      <button
        style={btnStyle}
        disabled={!!running}
        onClick={() =>
          run(`/api/admin/recalc-leaderboard?season=${season}`)
        }
      >
        Recalculate Leaderboard
        <div style={smallStyle}>
          Scores tips using stored odds snapshots.
        </div>
      </button>

      {/* Output */}
      {result && (
        <div style={{ marginTop: 40 }}>
          <h3>Last Result</h3>
          <pre
            style={{
              background: "#f3f3f3",
              padding: 16,
              borderRadius: 8,
              overflow: "auto",
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}