"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function AdminPage() {
  const router = useRouter();

  const [season, setSeason] = useState<number>(2026);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState<string | null>(null);

  async function run(path: string) {
    try {
      setLoading(path);
      setResult(null);

      // 🔐 Get current session access token
      const { data } = await supabaseBrowser.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setResult({ error: "Not authenticated." });
        return;
      }

      const res = await fetch(path, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const json = await res.json();
      setResult(json);
    } catch (err: any) {
      setResult({ error: err?.message ?? "Unknown error" });
    } finally {
      setLoading(null);
    }
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
            border: "1px solid #ccc",
            width: 120,
          }}
        />
      </div>

      <div
        style={{
          marginTop: 30,
          display: "grid",
          gap: 12,
        }}
      >
        <button
          onClick={() =>
            run(`/api/admin/snapshot-odds-all-due?season=${season}`)
          }
          style={btnStyle}
        >
          Snapshot Next Due Round
        </button>

        <button
          onClick={() =>
            run(`/api/admin/snapshot-odds-all-due?season=${season}&force=1`)
          }
          style={btnStyle}
        >
          Force Snapshot (Testing)
        </button>

        <button
          onClick={() =>
            run(`/api/admin/sync-results?season=${season}`)
          }
          style={btnStyle}
        >
          Sync Results
        </button>

        <button
          onClick={() =>
            run(`/api/admin/recalc-leaderboard?season=${season}`)
          }
          style={btnStyle}
        >
          Recalculate Leaderboard
        </button>

        <button
          onClick={() => router.push("/admin/members")}
          style={{
            ...btnStyle,
            background: "#111",
            color: "white",
            fontWeight: 800,
          }}
        >
          Manage Members
        </button>
      </div>

      {result && (
        <div
          style={{
            marginTop: 30,
            padding: 16,
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "#f9f9f9",
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
  border: "1px solid #ccc",
  background: "white",
  fontWeight: 600,
  cursor: "pointer",
};