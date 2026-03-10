"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { UnpaidTag } from "@/components/UnpaidTag";
import { ChampionCrown } from "@/components/ChampionCrown";
import { waitForSession } from "@/lib/session-client";

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
};

type PlayerRoundScore = {
  user_id: string;
  display_name: string;
  payment_status?: string | null;
  round_score: number;
  correct_tips: number;
  total_tips: number;
  accuracy_pct: number;
  avg_correct_odds: number;
  picks: Record<string, string>;
};

type RoundResultsResponse = {
  ok: boolean;
  season: number;
  round: number;
  reigning_champion_user_id?: string | null;
  lock_time_utc: string | null;
  snapshot_for_time_utc: string | null;
  matches: MatchResultRow[];
  players: PlayerRoundScore[];
  error?: string;
};

type RoundSortKey =
  | "rank"
  | "display_name"
  | "round_score"
  | "correct_tips"
  | "accuracy_pct"
  | "avg_correct_odds";

type SortDirection = "asc" | "desc";

const DEFAULT_SORT_DIR: Record<RoundSortKey, SortDirection> = {
  rank: "asc",
  display_name: "asc",
  round_score: "desc",
  correct_tips: "desc",
  accuracy_pct: "desc",
  avg_correct_odds: "desc",
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

function fmtPct(n: number) {
  const v = Number(n ?? 0);
  if (Number.isNaN(v)) return "0%";
  return `${Math.round(v)}%`;
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
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchResultRow[]>([]);
  const [players, setPlayers] = useState<PlayerRoundScore[]>([]);
  const [reigningChampionUserId, setReigningChampionUserId] = useState<string | null>(null);
  const [lockTimeUtc, setLockTimeUtc] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<RoundSortKey>("round_score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const invalidParams = !Number.isFinite(season) || !Number.isFinite(round);

  useEffect(() => {
    let alive = true;

    async function ensureSessionOrRedirect() {
      const session = await waitForSession(3000, 180);
      if (!alive) return;

      if (!session) {
        window.location.href = "/login";
        return;
      }

      setSessionToken(session.access_token);
      setMsg("Loading round results…");
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
    if (!sessionToken) return;

    (async () => {
      try {
        setMsg("Loading round results…");
        const res = await fetch(
          `/api/round-results?season=${encodeURIComponent(String(season))}&round=${encodeURIComponent(String(round))}`,
          {
            cache: "no-store",
            headers: { Authorization: `Bearer ${sessionToken}` },
          }
        );

        const json = (await res.json().catch(() => null)) as RoundResultsResponse | null;
        if (!res.ok || !json?.ok) {
          setMsg(json?.error || "Could not load round results.");
          return;
        }

        setMatches(Array.isArray(json.matches) ? json.matches : []);
        setPlayers(Array.isArray(json.players) ? json.players : []);
        setReigningChampionUserId(
          typeof json.reigning_champion_user_id === "string"
            ? json.reigning_champion_user_id
            : null
        );
        setLockTimeUtc(json.lock_time_utc ?? null);
        setMsg("");
      } catch {
        setMsg("Could not load round results.");
      }
    })();
  }, [season, round, invalidParams, sessionToken]);

  const finishedMatches = useMemo(() => {
    return matches.filter((m) => !!String(m.winner_team ?? "").trim()).length;
  }, [matches]);

  const tipsPlaced = useMemo(() => {
    return matches.reduce((acc, m) => acc + Number(m.total_tips ?? 0), 0);
  }, [matches]);

  const roundRankByUserId = useMemo(() => {
    const ranked = [...players].sort((a, b) => {
      if (b.round_score !== a.round_score) return b.round_score - a.round_score;
      if (b.correct_tips !== a.correct_tips) return b.correct_tips - a.correct_tips;
      return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
    });
    const out: Record<string, number> = {};
    ranked.forEach((p, idx) => {
      out[p.user_id] = idx + 1;
    });
    return out;
  }, [players]);

  const sortedPlayers = useMemo(() => {
    const list = [...players];
    const dir = sortDirection === "asc" ? 1 : -1;

    list.sort((a, b) => {
      let primaryCmp = 0;

      if (sortBy === "display_name") {
        primaryCmp = a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
      } else if (sortBy === "rank") {
        const aRank = roundRankByUserId[a.user_id] ?? Number.MAX_SAFE_INTEGER;
        const bRank = roundRankByUserId[b.user_id] ?? Number.MAX_SAFE_INTEGER;
        primaryCmp = aRank - bRank;
      } else if (sortBy === "round_score") {
        primaryCmp = a.round_score - b.round_score;
      } else if (sortBy === "correct_tips") {
        primaryCmp = a.correct_tips - b.correct_tips;
      } else if (sortBy === "accuracy_pct") {
        primaryCmp = a.accuracy_pct - b.accuracy_pct;
      } else {
        primaryCmp = a.avg_correct_odds - b.avg_correct_odds;
      }

      if (primaryCmp !== 0) {
        return primaryCmp * dir;
      }

      const aRank = roundRankByUserId[a.user_id] ?? Number.MAX_SAFE_INTEGER;
      const bRank = roundRankByUserId[b.user_id] ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;

      return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
    });

    return list;
  }, [players, roundRankByUserId, sortBy, sortDirection]);

  function onSort(nextKey: RoundSortKey) {
    if (sortBy === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(nextKey);
    setSortDirection(DEFAULT_SORT_DIR[nextKey]);
  }

  function sortMarker(key: RoundSortKey) {
    if (sortBy !== key) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  }

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
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "12px 12px 8px", fontWeight: 900, fontSize: 15 }}>Round leaderboard</div>
            {players.length === 0 ? (
              <div style={{ padding: "0 12px 12px", opacity: 0.72, fontSize: 12 }}>No tips found for this round.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--card-soft)", textAlign: "left", fontSize: 12 }}>
                      {(
                        [
                          ["Rank", "rank"],
                          ["Tipster", "display_name"],
                          [`Round Score (R${round})`, "round_score"],
                          ["Correct", "correct_tips"],
                          ["Round Accuracy", "accuracy_pct"],
                          ["Avg Correct Odds", "avg_correct_odds"],
                        ] as Array<[string, RoundSortKey]>
                      ).map(([label, key]) => (
                        <th
                          key={key}
                          style={{
                            padding: "10px 12px",
                            borderBottom: "1px solid var(--border)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => onSort(key)}
                            title={`Sort by ${label}`}
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              cursor: "pointer",
                              font: "inherit",
                              fontWeight: sortBy === key ? 800 : 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: 0,
                            }}
                          >
                            <span>{label}</span>
                            <span style={{ opacity: sortBy === key ? 1 : 0.45, fontSize: 11 }}>
                              {sortMarker(key)}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlayers.map((p) => (
                      <tr key={p.user_id}>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)", fontWeight: 900 }}>
                          #{roundRankByUserId[p.user_id] ?? "-"}
                        </td>
                        <td
                          style={{ padding: "12px", borderTop: "1px solid var(--border)", fontWeight: 700 }}
                          title={
                            p.payment_status === "pending"
                              ? `${p.display_name} (unpaid)`
                              : p.display_name
                          }
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <ChampionCrown isChampion={p.user_id === reigningChampionUserId} />
                            <UnpaidTag paymentStatus={p.payment_status ?? null} />
                            <span
                              style={{
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                display: "block",
                              }}
                            >
                              {p.display_name}
                            </span>
                          </span>
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)", fontWeight: 800 }}>
                          {fmtPts(p.round_score)}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
                          {p.correct_tips}/{p.total_tips}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
                          {fmtPct(p.accuracy_pct)}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
                          {fmtPts(p.avg_correct_odds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                </article>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
