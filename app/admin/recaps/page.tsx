"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type RecapRow = {
  id: number;
  season: number;
  round_number: number;
  recap_type: string;
  subject: string;
  narrative_text: string;
  raw_stats_text: string;
  generated_at: string;
  updated_at: string;
};

type RecapsResponse = {
  ok?: boolean;
  recaps?: RecapRow[];
  error?: string;
  details?: string;
  hint?: string;
};

function fmtMelbourne(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function AdminRecapsPage() {
  const [season, setSeason] = useState<number>(new Date().getFullYear());
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState("");
  const [recaps, setRecaps] = useState<RecapRow[]>([]);
  const [expandedRecapId, setExpandedRecapId] = useState<number | null>(null);

  async function fetchRecaps(sessionToken: string, year: number) {
    const res = await fetch(
      `/api/admin/round-recaps?season=${encodeURIComponent(String(year))}&limit=80`,
      {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
        cache: "no-store",
      }
    );

    const json = (await res.json().catch(() => null)) as RecapsResponse | null;
    if (!res.ok) {
      const parts = [json?.error ?? "Failed to load recaps"];
      if (json?.details) parts.push(json.details);
      if (json?.hint) parts.push(json.hint);
      throw new Error(parts.join(" - "));
    }

    return Array.isArray(json?.recaps) ? json.recaps : [];
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg("");
      try {
        const { data } = await supabaseBrowser.auth.getSession();
        const sessionToken = data.session?.access_token ?? null;
        if (!sessionToken) {
          setMsg("Not authenticated.");
          setRecaps([]);
          setExpandedRecapId(null);
          return;
        }

        setToken(sessionToken);
        const rows = await fetchRecaps(sessionToken, season);
        setRecaps(rows);
        setExpandedRecapId(rows[0]?.id ?? null);
      } catch (err: unknown) {
        setMsg(err instanceof Error ? err.message : "Failed to load recaps.");
      } finally {
        setLoading(false);
      }
    })();
  }, [season]);

  async function refreshNow() {
    if (!token) {
      setMsg("Not authenticated.");
      return;
    }
    try {
      setRefreshing(true);
      setMsg("");
      const rows = await fetchRecaps(token, season);
      setRecaps(rows);
      setExpandedRecapId((prev) => {
        if (!rows.length) return null;
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0].id;
      });
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : "Failed to refresh recaps.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <h1>Round Recaps</h1>
      <p style={{ marginTop: 6, opacity: 0.8 }}>
        Stored weekly recap history for admin use.
      </p>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <label style={{ fontWeight: 700 }}>Season</label>
        <input
          type="number"
          value={season}
          onChange={(e) => setSeason(Number(e.target.value || 0))}
          style={{
            width: 110,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--foreground)",
          }}
        />
        <button
          type="button"
          onClick={refreshNow}
          disabled={loading || refreshing}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--foreground)",
            fontWeight: 700,
            cursor: loading || refreshing ? "not-allowed" : "pointer",
            opacity: loading || refreshing ? 0.65 : 1,
          }}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {msg && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 10,
            border: "1px solid rgba(220, 38, 38, 0.45)",
            background: "rgba(220, 38, 38, 0.10)",
            color: "rgb(185, 28, 28)",
            fontWeight: 700,
          }}
        >
          {msg}
        </div>
      )}

      {loading ? (
        <div style={{ marginTop: 16, opacity: 0.75 }}>Loading recaps…</div>
      ) : recaps.length === 0 ? (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--card-soft)",
            opacity: 0.85,
          }}
        >
          No recaps found for season {season}.
        </div>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {recaps.map((r) => {
            const expanded = expandedRecapId === r.id;

            return (
              <section
                key={r.id}
                style={{
                  border: expanded ? "1px solid rgba(239, 68, 68, 0.55)" : "1px solid var(--border)",
                  borderRadius: 14,
                  background: expanded ? "rgba(239, 68, 68, 0.08)" : "var(--card)",
                  padding: 12,
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedRecapId((prev) => (prev === r.id ? null : r.id))}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: -0.2 }}>
                      Round {r.round_number}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>
                      {r.subject}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                      Season {r.season} • Generated {fmtMelbourne(r.generated_at)}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 900,
                      padding: "7px 10px",
                      borderRadius: 999,
                      border: "1px solid var(--border)",
                      background: "var(--card-soft)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {expanded ? "Hide recap" : "View recap"}
                  </div>
                </button>

                {expanded && (
                  <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                    <section
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--card-soft)",
                        borderRadius: 12,
                        padding: 14,
                      }}
                    >
                      <h2 style={{ margin: 0, fontSize: 18 }}>Narrative</h2>
                      <pre
                        style={{
                          marginTop: 10,
                          whiteSpace: "pre-wrap",
                          fontFamily: "inherit",
                          lineHeight: 1.5,
                        }}
                      >
                        {r.narrative_text}
                      </pre>
                    </section>

                    <details
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--card-soft)",
                        borderRadius: 12,
                        padding: 14,
                      }}
                    >
                      <summary style={{ cursor: "pointer", fontWeight: 800 }}>Raw Stats</summary>
                      <pre
                        style={{
                          marginTop: 10,
                          whiteSpace: "pre-wrap",
                          fontFamily: "inherit",
                          lineHeight: 1.45,
                        }}
                      >
                        {r.raw_stats_text}
                      </pre>
                    </details>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
