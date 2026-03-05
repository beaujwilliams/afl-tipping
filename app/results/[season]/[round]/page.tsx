"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type MatchTip = {
  user_id: string;
  display_name: string;
  picked_team: string;
  is_correct: boolean | null;
  points: number;
};

type MatchResultRow = {
  id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  venue: string | null;
  status: string | null;
  winner_team: string | null;
  total_tips: number;
  tipping: {
    home_team: string;
    away_team: string;
    home_count: number;
    away_count: number;
    home_pct: number;
    away_pct: number;
  };
  tipped_by: MatchTip[];
};

type PlayerRoundScore = {
  user_id: string;
  display_name: string;
  round_score: number;
  correct_tips: number;
  total_tips: number;
  picks: Record<string, string>;
};

type RoundResultsResponse = {
  ok: boolean;
  season: number;
  round: number;
  lock_time_utc: string | null;
  snapshot_for_time_utc: string | null;
  matches: MatchResultRow[];
  players: PlayerRoundScore[];
  top_score: number;
  top_scorers: PlayerRoundScore[];
  error?: string;
};

const VENUE_MAP: Record<string, string> = {
  "Sydney Showground": "ENGIE Stadium",
  "Sydney Showground Stadium": "ENGIE Stadium",
  "S.C.G.": "SCG",
  SCG: "SCG",
  Docklands: "Marvel Stadium",
  "Etihad Stadium": "Marvel Stadium",
  "Marvel Stadium": "Marvel Stadium",
  "M.C.G.": "MCG",
  MCG: "MCG",
  "Kardinia Park": "GMHBA Stadium",
  "G.M.H.B.A. Stadium": "GMHBA Stadium",
  "GMHBA Stadium": "GMHBA Stadium",
  "Adelaide Oval": "Adelaide Oval",
  "Perth Stadium": "Optus Stadium",
  "Optus Stadium": "Optus Stadium",
  "Brisbane Cricket Ground": "The Gabba",
  Gabba: "The Gabba",
  Carrara: "Heritage Bank Stadium",
  "Metricon Stadium": "Heritage Bank Stadium",
  "Heritage Bank Stadium": "Heritage Bank Stadium",
  "Bellerive Oval": "Blundstone Arena",
  "Blundstone Arena": "Blundstone Arena",
  "York Park": "UTAS Stadium",
  "UTAS Stadium": "UTAS Stadium",
  "TIO Stadium": "TIO Stadium",
};

function normalizeVenue(v: string | null) {
  if (!v) return "TBC";
  const key = v.trim();
  return VENUE_MAP[key] ?? key;
}

function formatMelbourne(isoUtc: string | null) {
  if (!isoUtc) return "";
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtPts(n: number) {
  const v = Number(n ?? 0);
  if (Number.isNaN(v)) return "0.00";
  return v.toFixed(2);
}

function pctBar(pct: number) {
  const safe = Math.max(0, Math.min(100, Number(pct) || 0));
  return `${safe}%`;
}

export default function RoundResultsDetailPage() {
  const params = useParams<{ season: string; round: string }>();
  const season = Number(params.season);
  const round = Number(params.round);

  const [msg, setMsg] = useState<string>("Checking session…");
  const [matches, setMatches] = useState<MatchResultRow[]>([]);
  const [players, setPlayers] = useState<PlayerRoundScore[]>([]);
  const [topScore, setTopScore] = useState(0);
  const [topScorers, setTopScorers] = useState<PlayerRoundScore[]>([]);
  const [lockTimeUtc, setLockTimeUtc] = useState<string | null>(null);
  const invalidParams = !Number.isFinite(season) || !Number.isFinite(round);

  useEffect(() => {
    let alive = true;

    async function ensureSessionOrRedirect() {
      const { data } = await supabaseBrowser.auth.getSession();
      if (!alive) return;

      if (data.session) {
        setMsg("Loading round results…");
        return;
      }

      const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
        if (session) {
          setMsg("Loading round results…");
          sub.subscription.unsubscribe();
        }
      });

      setTimeout(async () => {
        const { data: again } = await supabaseBrowser.auth.getSession();
        if (!alive) return;

        if (!again.session) window.location.href = "/login";
        else setMsg("Loading round results…");

        sub.subscription.unsubscribe();
      }, 1200);
    }

    ensureSessionOrRedirect();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (invalidParams) {
      return;
    }

    (async () => {
      try {
        setMsg("Loading round results…");
        const res = await fetch(
          `/api/round-results?season=${encodeURIComponent(String(season))}&round=${encodeURIComponent(String(round))}`,
          { cache: "no-store" }
        );

        const json = (await res.json().catch(() => null)) as RoundResultsResponse | null;
        if (!res.ok || !json?.ok) {
          setMsg(json?.error || "Could not load round results.");
          return;
        }

        setMatches(Array.isArray(json.matches) ? json.matches : []);
        setPlayers(Array.isArray(json.players) ? json.players : []);
        setTopScore(Number(json.top_score ?? 0));
        setTopScorers(Array.isArray(json.top_scorers) ? json.top_scorers : []);
        setLockTimeUtc(json.lock_time_utc ?? null);
        setMsg("");
      } catch {
        setMsg("Could not load round results.");
      }
    })();
  }, [season, round, invalidParams]);

  const finishedMatches = useMemo(() => {
    return matches.filter((m) => !!String(m.winner_team ?? "").trim()).length;
  }, [matches]);

  const tipsPlaced = useMemo(() => {
    return matches.reduce((acc, m) => acc + Number(m.total_tips ?? 0), 0);
  }, [matches]);

  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, letterSpacing: -0.4 }}>
            Round {round} Results
          </h1>
          <div style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>
            Season {season} • {lockTimeUtc ? `Locked ${formatMelbourne(lockTimeUtc)}` : "Lock time unavailable"}
          </div>
        </div>

        <Link
          href={`/results/${season}`}
          style={{
            alignSelf: "flex-start",
            fontSize: 13,
            fontWeight: 800,
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "8px 10px",
            textDecoration: "none",
          }}
        >
          Back to rounds
        </Link>
      </div>

      {invalidParams && <div style={{ marginTop: 14, opacity: 0.82 }}>Invalid season/round.</div>}
      {!invalidParams && msg && <div style={{ marginTop: 14, opacity: 0.82 }}>{msg}</div>}

      {!invalidParams && !msg && (
        <>
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 10,
                background: "var(--card-soft)",
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.72 }}>Matches finished</div>
              <div style={{ marginTop: 5, fontSize: 22, fontWeight: 900 }}>
                {finishedMatches}/{matches.length}
              </div>
            </div>

            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 10,
                background: "var(--card-soft)",
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.72 }}>Total tips</div>
              <div style={{ marginTop: 5, fontSize: 22, fontWeight: 900 }}>{tipsPlaced}</div>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 12,
              background: "var(--card-soft)",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 15 }}>Top scorer(s) this round</div>
            {topScorers.length > 0 ? (
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {topScorers.map((p) => (
                  <div
                    key={p.user_id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      borderTop: "1px solid rgba(127,127,127,0.25)",
                      paddingTop: 7,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontWeight: 800 }}>{p.display_name}</span>
                    <span style={{ fontWeight: 900 }}>{fmtPts(topScore)} pts</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 8, opacity: 0.72, fontSize: 12 }}>
                No round leader yet (results may still be pending).
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: 12,
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 15 }}>Round leaderboard</div>
            {players.length === 0 ? (
              <div style={{ marginTop: 8, opacity: 0.72, fontSize: 12 }}>No tips found for this round.</div>
            ) : (
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {players.map((p, idx) => (
                  <div
                    key={p.user_id}
                    style={{
                      border: "1px solid rgba(127,127,127,0.30)",
                      borderRadius: 10,
                      padding: 10,
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.7 }}>#{idx + 1}</div>
                    <div>
                      <div style={{ fontWeight: 850, fontSize: 13 }}>{p.display_name}</div>
                      <div style={{ marginTop: 3, fontSize: 11, opacity: 0.75 }}>
                        Correct: {p.correct_tips}/{p.total_tips}
                      </div>
                    </div>
                    <div style={{ fontWeight: 900, fontSize: 14 }}>{fmtPts(p.round_score)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            {matches.map((m) => {
              const winner = String(m.winner_team ?? "").trim();
              const finished = !!winner;

              return (
                <article
                  key={m.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 12,
                    background: "var(--card)",
                  }}
                >
                  <div style={{ fontSize: 11, opacity: 0.72 }}>
                    {formatMelbourne(m.commence_time_utc)} • {normalizeVenue(m.venue)}
                  </div>

                  <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1.2 }}>
                      {m.home_team} vs {m.away_team}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 900,
                        padding: "6px 8px",
                        borderRadius: 999,
                        border: "1px solid rgba(127,127,127,0.30)",
                        whiteSpace: "nowrap",
                        alignSelf: "flex-start",
                      }}
                    >
                      {finished ? `Winner: ${winner}` : "Pending"}
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Tipping percentages ({m.total_tips} tips)
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      <div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            fontSize: 12,
                            marginBottom: 4,
                          }}
                        >
                          <span>{m.home_team}</span>
                          <span>
                            {m.tipping.home_pct}% ({m.tipping.home_count})
                          </span>
                        </div>
                        <div
                          style={{
                            height: 8,
                            borderRadius: 999,
                            background: "rgba(127,127,127,0.20)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: pctBar(m.tipping.home_pct),
                              height: "100%",
                              background: "rgb(59,130,246)",
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            fontSize: 12,
                            marginBottom: 4,
                          }}
                        >
                          <span>{m.away_team}</span>
                          <span>
                            {m.tipping.away_pct}% ({m.tipping.away_count})
                          </span>
                        </div>
                        <div
                          style={{
                            height: 8,
                            borderRadius: 999,
                            background: "rgba(127,127,127,0.20)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: pctBar(m.tipping.away_pct),
                              height: "100%",
                              background: "rgb(16,185,129)",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 800 }}>Who tipped what</div>
                    {m.tipped_by.length === 0 ? (
                      <div style={{ marginTop: 6, opacity: 0.72, fontSize: 12 }}>No tips for this match.</div>
                    ) : (
                      <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                        {m.tipped_by.map((t) => (
                          <div
                            key={`${m.id}:${t.user_id}`}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              borderTop: "1px solid rgba(127,127,127,0.25)",
                              paddingTop: 6,
                              fontSize: 12,
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>{t.display_name}</span>
                            <span>
                              {t.picked_team}
                              {t.is_correct === true && (
                                <span style={{ marginLeft: 8, color: "rgb(16,185,129)", fontWeight: 800 }}>
                                  +{fmtPts(t.points)}
                                </span>
                              )}
                              {t.is_correct === false && (
                                <span style={{ marginLeft: 8, color: "rgb(239,68,68)", fontWeight: 800 }}>
                                  0
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
