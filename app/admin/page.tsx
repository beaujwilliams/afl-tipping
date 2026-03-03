"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type RunResult = { ok?: boolean; error?: string; [key: string]: any };

const ADMIN_EMAIL = "beau.j.williams@gmail.com";

export default function AdminPage() {
  const [season, setSeason] = useState<number>(2026);
  const [specificRound, setSpecificRound] = useState<number>(0);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Checking login…");

  const [running, setRunning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);

  const baseUrl = useMemo(
    () => (typeof window === "undefined" ? "" : window.location.origin),
    []
  );

  useEffect(() => {
    (async () => {
      const { data } = await supabaseBrowser.auth.getUser();

      if (!data.user) {
        window.location.href = "/login";
        return;
      }

      const email = data.user.email ?? "";
      setUserEmail(email);

      if (email !== ADMIN_EMAIL) {
        window.location.href = "/";
        return;
      }

      setStatus("");
    })();
  }, []);

  async function run(path: string) {
    setRunning(path);
    setLastResult(null);

    try {
      const fullUrl = `${baseUrl}${path}`;

      // ✅ send Bearer token for admin APIs
      const { data: sessionData } = await supabaseBrowser.auth.getSession();
      const token = sessionData.session?.access_token;

      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // Optional: if you ever add a public bypass var for preview use (not required)
      const bypass = process.env.NEXT_PUBLIC_VERCEL_BYPASS_SECRET;
      if (bypass) headers["x-vercel-protection-bypass"] = bypass;

      const res = await fetch(fullUrl, { method: "GET", headers });
      const text = await res.text();

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: "Non-JSON response", status: res.status, bodyHead: text.slice(0, 800) };
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
    fontWeight: 800,
    opacity: running ? 0.7 : 1,
  };

  const smallStyle: React.CSSProperties = {
    fontSize: 12,
    opacity: 0.75,
    marginTop: 6,
    fontWeight: 500,
    lineHeight: 1.35,
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    marginTop: 10,
    flexWrap: "wrap",
  };

  const inputStyle: React.CSSProperties = {
    width: 130,
    padding: 10,
    borderRadius: 10,
    border: "1px solid #ccc",
  };

  const miniBtn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ddd",
    background: "white",
    cursor: "pointer",
    fontWeight: 800,
  };

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1>Admin Tools</h1>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      {!status && (
        <>
          <div style={cardStyle}>
            <div style={{ fontSize: 14, opacity: 0.7 }}>Signed in as</div>
            <div style={{ fontWeight: 900 }}>{userEmail}</div>

            <div style={rowStyle}>
              <label>
                <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Season</div>
                <input
                  value={season}
                  onChange={(e) => setSeason(Number(e.target.value))}
                  type="number"
                  style={inputStyle}
                />
              </label>

              <label>
                <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Specific round</div>
                <input
                  value={specificRound}
                  onChange={(e) => setSpecificRound(Number(e.target.value))}
                  type="number"
                  style={inputStyle}
                />
              </label>

              <button
                style={miniBtn}
                disabled={!!running}
                onClick={() => run(`/api/admin/snapshot-odds?season=${season}&round=${specificRound}`)}
              >
                Snapshot specific round
              </button>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
              Tip: Round 0 = Opening Round (as you’re using it)
            </div>
          </div>

          <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() => run(`/api/admin/run-automation?season=${season}`)}
            >
              🚀 Run Automation (Snapshot → Sync → Recalc)
              <div style={smallStyle}>
                Runs next due odds snapshot, syncs results, then recalculates leaderboard.
              </div>
            </button>

            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() => run(`/api/admin/snapshot-odds-all-due?season=${season}&limit=1`)}
            >
              ✅ Snapshot Next Due Round (safe)
              <div style={smallStyle}>
                Runs only the next due round (limit=1). Best for daily automation.
              </div>
            </button>

            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() => run(`/api/admin/snapshot-odds-all-due?season=${season}`)}
            >
              ✅ Snapshot Odds (Due only — safe)
              <div style={smallStyle}>
                Runs every round that is currently due (but skips rounds already captured).
              </div>
            </button>

            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() => run(`/api/admin/snapshot-odds-all-due?season=${season}&force=1`)}
            >
              🔧 Snapshot Odds (FORCE — testing)
              <div style={smallStyle}>
                Forces all rounds as “due”. Use only when debugging.
              </div>
            </button>

            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() => run(`/api/admin/sync-results?season=${season}`)}
            >
              2️⃣ Sync Results (Squiggle)
              <div style={smallStyle}>Pulls final games and updates winners.</div>
            </button>

            <button
              style={btnStyle}
              disabled={!!running}
              onClick={() => run(`/api/admin/recalc-leaderboard?season=${season}`)}
            >
              3️⃣ Recalculate Leaderboard
              <div style={smallStyle}>Totals tips and writes leaderboard entries.</div>
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