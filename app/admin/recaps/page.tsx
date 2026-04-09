"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiButton, UiButtonLink, UiCard, UiSectionHeader } from "@/components/ui";

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

    return Array.isArray(json?.recaps)
      ? [...json.recaps].sort(
          (a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
        )
      : [];
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

  const latestRecap = recaps[0] ?? null;

  return (
    <main className="ui-page ui-page--wide ui-admin-page">
      <div className="ui-page-header">
        <div>
          <h1 className="ui-title">Recap Archive</h1>
          <div className="ui-caption ui-mt-1">
            Stored weekly recap history for admin review, context, and reruns.
          </div>
        </div>
        <div className="ui-row-wrap">
          <UiButtonLink href="/admin">Back to admin</UiButtonLink>
          <UiButton onClick={() => void refreshNow()} disabled={loading || refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </UiButton>
        </div>
      </div>

      <UiCard soft className="ui-admin-section" style={{ marginTop: 12 }}>
        <UiSectionHeader
          title={`Season ${season} recap archive`}
          subtitle="Use this page when you want the stored narrative and raw stats behind each round recap."
          right={
            <label className="ui-row-wrap">
              <span className="ui-caption">Season</span>
              <input
                type="number"
                value={season}
                onChange={(e) => setSeason(Number(e.target.value || 0))}
                className="ui-input"
                style={{ width: 110 }}
              />
            </label>
          }
        />
      </UiCard>

      <div className="ui-card-grid ui-card-grid--3 ui-mt-3">
        <UiCard soft>
          <div className="ui-kicker">Stored recaps</div>
          <div className="ui-value">{recaps.length}</div>
          <div className="ui-meta">Round recap entries currently stored for this season.</div>
        </UiCard>
        <UiCard soft>
          <div className="ui-kicker">Latest round</div>
          <div className="ui-value">{latestRecap ? latestRecap.round_number : "—"}</div>
          <div className="ui-meta">
            {latestRecap ? latestRecap.subject : `No recap records yet for season ${season}.`}
          </div>
        </UiCard>
        <UiCard soft>
          <div className="ui-kicker">Most recent generated</div>
          <div className="ui-value" style={{ fontSize: 24 }}>
            {latestRecap ? fmtMelbourne(latestRecap.generated_at) : "—"}
          </div>
          <div className="ui-meta">Useful when you want to confirm whether a recap already exists.</div>
        </UiCard>
      </div>

      {msg && (
        <UiCard soft tone="danger" style={{ marginTop: 14 }}>
          {msg}
        </UiCard>
      )}

      {loading ? (
        <UiCard soft style={{ marginTop: 16, opacity: 0.75 }}>
          Loading recaps…
        </UiCard>
      ) : recaps.length === 0 ? (
        <UiCard soft style={{ marginTop: 16, opacity: 0.85 }}>
          No recaps found for season {season}.
        </UiCard>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {recaps.map((r) => {
            const expanded = expandedRecapId === r.id;

            return (
              <UiCard
                key={r.id}
                style={{
                  border: expanded ? "1px solid rgba(239, 68, 68, 0.55)" : "1px solid var(--border)",
                  background: expanded ? "rgba(239, 68, 68, 0.08)" : "var(--card)",
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
              </UiCard>
            );
          })}
        </div>
      )}
    </main>
  );
}
