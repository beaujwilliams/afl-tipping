"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import CopyToClipboardButton from "@/components/CopyToClipboardButton";
import { waitForSession } from "@/lib/session-client";

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

export default function SeasonRecapsPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);
  const invalidSeason = !Number.isFinite(season) || season < 2000 || season > 2100;

  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState("Checking session…");
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
      if (res.status === 403) {
        throw new Error("Round recaps are private and only visible to admin users.");
      }
      const parts = [json?.error ?? "Failed to load recaps"];
      if (json?.details) parts.push(json.details);
      if (json?.hint) parts.push(json.hint);
      throw new Error(parts.join(" - "));
    }

    return Array.isArray(json?.recaps) ? json.recaps : [];
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      if (invalidSeason) {
        setLoading(false);
        setMsg("Invalid season.");
        return;
      }

      const session = await waitForSession(3000, 180);
      if (!alive) return;
      if (!session) {
        window.location.href = "/login";
        return;
      }

      setToken(session.access_token);
    })();

    return () => {
      alive = false;
    };
  }, [invalidSeason]);

  useEffect(() => {
    if (!token || invalidSeason) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setMsg("");
      try {
        const rows = await fetchRecaps(token, season);
        if (!alive) return;
        setRecaps(rows);
        setExpandedRecapId(rows[0]?.id ?? null);
      } catch (err: unknown) {
        if (!alive) return;
        setMsg(err instanceof Error ? err.message : "Failed to load recaps.");
        setRecaps([]);
        setExpandedRecapId(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [token, season, invalidSeason]);

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
    <main style={{ maxWidth: 980, margin: "36px auto", padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Round Recaps • {season}</h1>
          <p style={{ marginTop: 6, opacity: 0.8 }}>
            Private recap archive. Only admin users can view this page.
          </p>
        </div>
        <Link
          href={`/results/${season}`}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--foreground)",
            textDecoration: "none",
            fontWeight: 700,
          }}
        >
          Back to Round Results
        </Link>
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={refreshNow}
          disabled={loading || refreshing || invalidSeason}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--foreground)",
            fontWeight: 700,
            cursor: loading || refreshing || invalidSeason ? "not-allowed" : "pointer",
            opacity: loading || refreshing || invalidSeason ? 0.65 : 1,
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
                      <div className="ui-recap-section-head">
                        <h2 style={{ margin: 0, fontSize: 18 }}>Narrative</h2>
                        <CopyToClipboardButton
                          value={r.narrative_text}
                          label={`Copy Round ${r.round_number} recap`}
                          failureMessage={`Could not copy the Round ${r.round_number} recap.`}
                        />
                      </div>
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
