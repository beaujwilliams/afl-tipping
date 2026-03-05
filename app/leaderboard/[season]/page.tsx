"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type LeaderboardRow = {
  user_id: string;
  display_name: string;
  rank: number;
  total_points: number;
  correct_tips: number;
  tips_submitted: number;
  tips_possible: number;
  missed_tips: number;
  accuracy_pct: number;
  round_score: number;
  movement: number;
  previous_rank: number | null;
  behind_leader: number;
  current_streak: number;
  avg_winning_odds: number;
};

type LeaderboardResponse = {
  ok: boolean;
  season: number;
  latest_scored_round: number | null;
  previous_round_for_movement: number | null;
  matches_scored: number;
  rows: LeaderboardRow[];
  error?: string;
};

type SortKey =
  | "rank"
  | "display_name"
  | "total_points"
  | "correct_tips"
  | "accuracy_pct"
  | "tips_submitted"
  | "missed_tips"
  | "round_score"
  | "movement"
  | "behind_leader"
  | "current_streak"
  | "avg_winning_odds";

type SortDirection = "asc" | "desc";
type NumericSortKey = Exclude<SortKey, "display_name">;

const DEFAULT_SORT_DIR: Record<SortKey, SortDirection> = {
  rank: "asc",
  display_name: "asc",
  total_points: "desc",
  correct_tips: "desc",
  accuracy_pct: "desc",
  tips_submitted: "desc",
  missed_tips: "asc",
  round_score: "desc",
  movement: "desc",
  behind_leader: "asc",
  current_streak: "desc",
  avg_winning_odds: "desc",
};

const RANK_COL_WIDTH = 72;
const TIPSTER_COL_WIDTH = 190;

function fmtPts(n: number) {
  return Number(n ?? 0).toFixed(2);
}

function fmtPct(n: number) {
  return `${Number(n ?? 0).toFixed(1)}%`;
}

function movementText(movement: number) {
  if (movement > 0) return `▲ ${movement}`;
  if (movement < 0) return `▼ ${Math.abs(movement)}`;
  return "-";
}

function movementColor(movement: number) {
  if (movement > 0) return "#17803d";
  if (movement < 0) return "#b42318";
  return "var(--muted)";
}

function numericSortValue(row: LeaderboardRow, key: NumericSortKey) {
  if (key === "rank") return row.rank;
  if (key === "total_points") return row.total_points;
  if (key === "correct_tips") return row.correct_tips;
  if (key === "accuracy_pct") return row.accuracy_pct;
  if (key === "tips_submitted") return row.tips_submitted;
  if (key === "missed_tips") return row.missed_tips;
  if (key === "round_score") return row.round_score;
  if (key === "movement") return row.movement;
  if (key === "behind_leader") return row.behind_leader;
  if (key === "current_streak") return row.current_streak;
  return row.avg_winning_odds;
}

function stickyColumnStyle(col: 1 | 2, isHeader: boolean) {
  return {
    position: "sticky" as const,
    left: col === 1 ? 0 : RANK_COL_WIDTH,
    zIndex: isHeader ? (col === 1 ? 5 : 4) : (col === 1 ? 3 : 2),
    background: isHeader ? "var(--card-soft)" : "var(--card)",
    width: col === 1 ? RANK_COL_WIDTH : TIPSTER_COL_WIDTH,
    minWidth: col === 1 ? RANK_COL_WIDTH : TIPSTER_COL_WIDTH,
    maxWidth: col === 1 ? RANK_COL_WIDTH : TIPSTER_COL_WIDTH,
    boxShadow: col === 2 ? "2px 0 0 var(--border)" : "none",
  };
}

export default function LeaderboardPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [latestScoredRound, setLatestScoredRound] = useState<number | null>(null);
  const [previousRoundForMovement, setPreviousRoundForMovement] = useState<number | null>(null);
  const [matchesScored, setMatchesScored] = useState(0);
  const [msg, setMsg] = useState("Loading...");
  const [sortBy, setSortBy] = useState<SortKey>("total_points");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    (async () => {
      setMsg("Loading...");

      const { data: auth } = await supabaseBrowser.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }

      const res = await fetch(`/api/leaderboard?season=${encodeURIComponent(String(season))}`, {
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as LeaderboardResponse | null;
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Could not load leaderboard.");
        return;
      }

      setRows(Array.isArray(json.rows) ? json.rows : []);
      setLatestScoredRound(json.latest_scored_round ?? null);
      setPreviousRoundForMovement(json.previous_round_for_movement ?? null);
      setMatchesScored(Number(json.matches_scored ?? 0));
      setMsg("");
    })();
  }, [season]);

  const sortedRows = useMemo(() => {
    const list = [...rows];

    list.sort((a, b) => {
      let cmp = 0;

      if (sortBy === "display_name") {
        cmp = a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
      } else {
        cmp = numericSortValue(a, sortBy) - numericSortValue(b, sortBy);
      }

      if (cmp === 0) {
        cmp = a.rank - b.rank;
      }
      if (cmp === 0) {
        cmp = a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
      }

      return sortDirection === "asc" ? cmp : -cmp;
    });

    return list;
  }, [rows, sortBy, sortDirection]);

  function onSort(nextKey: SortKey) {
    if (sortBy === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(nextKey);
    setSortDirection(DEFAULT_SORT_DIR[nextKey]);
  }

  function sortMarker(key: SortKey) {
    if (sortBy !== key) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  function sortableHeader(label: string, key: SortKey, stickyCol?: 1 | 2) {
    return (
      <th
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          ...(stickyCol ? stickyColumnStyle(stickyCol, true) : {}),
        }}
      >
        <button
          type="button"
          onClick={() => onSort(key)}
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
          title={`Sort by ${label}`}
        >
          <span>{label}</span>
          <span style={{ opacity: sortBy === key ? 1 : 0.45, fontSize: 11 }}>{sortMarker(key)}</span>
        </button>
      </th>
    );
  }

  return (
    <main style={{ maxWidth: 1250, margin: "32px auto", padding: 16 }}>
      <h1>Leaderboard • {season}</h1>

      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}

      {!msg && (
        <>
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
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
              <div style={{ fontSize: 11, opacity: 0.7 }}>Matches scored</div>
              <div style={{ marginTop: 4, fontWeight: 900, fontSize: 22 }}>{matchesScored}</div>
            </div>

            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 10,
                background: "var(--card-soft)",
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.7 }}>Round score column</div>
              <div style={{ marginTop: 4, fontWeight: 900, fontSize: 22 }}>
                {latestScoredRound === null ? "-" : `R${latestScoredRound}`}
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
              <div style={{ fontSize: 11, opacity: 0.7 }}>Movement baseline</div>
              <div style={{ marginTop: 4, fontWeight: 900, fontSize: 22 }}>
                {previousRoundForMovement === null ? "-" : `End of R${previousRoundForMovement}`}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 14,
              border: "1px solid var(--border)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {rows.length === 0 ? (
              <div style={{ padding: 16, opacity: 0.82 }}>No leaderboard data yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 1120, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--card-soft)", textAlign: "left", fontSize: 12 }}>
                      {sortableHeader("Rank", "rank", 1)}
                      {sortableHeader("Tipster", "display_name", 2)}
                      {sortableHeader("Total Pts", "total_points")}
                      {sortableHeader("Correct", "correct_tips")}
                      {sortableHeader("Accuracy", "accuracy_pct")}
                      {sortableHeader("Tips", "tips_submitted")}
                      {sortableHeader("Missed", "missed_tips")}
                      {sortableHeader(
                        latestScoredRound === null ? "Round Score" : `Round Score (R${latestScoredRound})`,
                        "round_score"
                      )}
                      {sortableHeader("Move", "movement")}
                      {sortableHeader("Behind", "behind_leader")}
                      {sortableHeader("Streak", "current_streak")}
                      {sortableHeader("Avg Win Odds", "avg_winning_odds")}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => (
                      <tr key={r.user_id}>
                        <td
                          style={{
                            padding: "12px",
                            borderTop: "1px solid var(--border)",
                            fontWeight: 900,
                            ...stickyColumnStyle(1, false),
                          }}
                        >
                          #{r.rank}
                        </td>
                        <td
                          style={{
                            padding: "12px",
                            borderTop: "1px solid var(--border)",
                            fontWeight: 700,
                            ...stickyColumnStyle(2, false),
                          }}
                        >
                          {r.display_name}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)", fontWeight: 800 }}>
                          {fmtPts(r.total_points)}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
                          {r.correct_tips}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
                          {fmtPct(r.accuracy_pct)}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
                          {r.tips_submitted}/{r.tips_possible}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
                          {r.missed_tips}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)", fontWeight: 700 }}>
                          {fmtPts(r.round_score)}
                        </td>
                        <td
                          style={{
                            padding: "12px",
                            borderTop: "1px solid var(--border)",
                            color: movementColor(r.movement),
                            fontWeight: 800,
                          }}
                          title={r.previous_rank ? `Previously #${r.previous_rank}` : "No previous round baseline"}
                        >
                          {movementText(r.movement)}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
                          {r.behind_leader <= 0 ? "-" : fmtPts(r.behind_leader)}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
                          {r.current_streak}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)" }}>
                          {fmtPts(r.avg_winning_odds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
