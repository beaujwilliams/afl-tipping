"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const CRON_SECRET = "";

type RunResult = { ok?: boolean; error?: string; [key: string]: any };

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

  const baseUrl = useMemo(() => (typeof window === "undefined" ? "" : window.location.origin), []);

  async function run(path: string) {
    setRunning(path);
    setLastResult(null);

    try {
      const fullUrl = `${baseUrl}${path}&secret=${process.env.NEXT_PUBLIC_CRON_SECRET}`;      const res = await fetch(fullUrl, { method: "GET" });
      const text = await res.text();

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: "Non-JSON response", bodyHead: text.slice(0, 500) };
      }

      setLastResult(json);
    } catch (e: any) {
      setLastResult({ error: e?.message ?? "Unknown error" });
    } finally {
      setRunning(null);
    }
  }

  const cardStyle: React.CSSProperties = {
    marginTop: 12,
    padding: 16,
    border: "1px solid #eee",
    borderRadius: 14,
  };

  const btnStyle: React.CSSProperties = {
    width: "100%",
    padding: "16px",
    borderRadius: 14,
    border: "1px solid #ddd",
    background: "white",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 16,
    fontWeight: 700,
  };

  const smallStyle: React.CSSProperties = { fontSize: 12, opacity: 0.75, marginTop: 6 };

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1>Admin Tools</h1>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      {!status && (
        <>
          <div style={cardStyle}>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Signed in as</div>
            <div style={{ fontWeight: 800 }}>{userEmail}</div>

            <div style={{ marginTop: 12 }}>
              <label>
                <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Season</div>
                <input
                  value={season}
                  onChange={(e) => setSeason(Number(e.target.value))}
                  type="number"
                  style={{
                    width: 140,
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #ccc",
                  }}
                />
              </label>

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                Secret is hard-coded for local use. Don’t deploy this version publicly.
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() => run(`/api/admin/snapshot-odds-all-due?season=${season}&force=1`)}
            >
              1️⃣ Snapshot Odds (ALL DUE — Force)
              <div style={smallStyle}>
                Captures Sportsbet decimal odds for rounds that are due. Force lets you test anytime.
              </div>
            </button>

            <button style={btnStyle} disabled={!!running} onClick={() => run(`/api/admin/sync-results?season=${season}`)}>
              2️⃣ Sync Results (Squiggle)
              <div style={smallStyle}>Updates matches with winner_team once games are final.</div>
            </button>

            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() => run(`/api/admin/recalc-leaderboard?season=${season}`)}
            >
              3️⃣ Recalculate Leaderboard
              <div style={smallStyle}>Scores tips using your 12pm snapshot rule and updates leaderboard_entries.</div>
            </button>
          </div>

          <div style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 18 }}>Last Result</h2>
            <pre
              style={{
                marginTop: 8,
                padding: 14,
                borderRadius: 14,
                border: "1px solid #eee",
                background: "#fafafa",
                overflow: "auto",
              }}
            >
              {lastResult ? JSON.stringify(lastResult, null, 2) : "No runs yet."}
            </pre>
          </div>
        </>
      )}
    </main>
  );
}