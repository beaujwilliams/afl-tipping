"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UnpaidTag } from "@/components/UnpaidTag";
import { ChampionCrown } from "@/components/ChampionCrown";
import { UiTableCell, UiTableHeadCell, UiTableScroll, UiTableShell } from "@/components/ui";

type LeaderboardRow = {
  user_id: string;
  display_name: string;
  payment_status?: string | null;
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
  reigning_champion_user_id?: string | null;
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
  round_score: "desc",
  movement: "desc",
  behind_leader: "asc",
  current_streak: "desc",
  avg_winning_odds: "desc",
};

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
  if (key === "round_score") return row.round_score;
  if (key === "movement") return row.movement;
  if (key === "behind_leader") return row.behind_leader;
  if (key === "current_streak") return row.current_streak;
  return row.avg_winning_odds;
}

export default function LeaderboardPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [reigningChampionUserId, setReigningChampionUserId] = useState<string | null>(null);
  const [msg, setMsg] = useState("Loading...");
  const [sortBy, setSortBy] = useState<SortKey>("total_points");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isMobile, setIsMobile] = useState(false);

  function applyLeaderboardData(json: LeaderboardResponse) {
    setRows(Array.isArray(json.rows) ? json.rows : []);
    setReigningChampionUserId(
      typeof json.reigning_champion_user_id === "string"
        ? json.reigning_champion_user_id
        : null
    );
  }

  useEffect(() => {
    (async () => {
      const cacheKey = `leaderboard_cache_v1_${season}`;
      let usedCached = false;

      try {
        const cached = window.sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as LeaderboardResponse;
          if (parsed?.ok && Array.isArray(parsed.rows)) {
            applyLeaderboardData(parsed);
            setMsg("");
            usedCached = true;
          }
        }
      } catch {
        // Ignore parse/cache errors and continue to network.
      }

      if (!usedCached) {
        setMsg("Loading...");
      }

      const { data: auth } = await supabaseBrowser.auth.getSession();
      if (!auth.session) {
        window.location.href = "/login";
        return;
      }

      const res = await fetch(`/api/leaderboard?season=${encodeURIComponent(String(season))}`);

      const json = (await res.json().catch(() => null)) as LeaderboardResponse | null;
      if (!res.ok || !json?.ok) {
        if (!usedCached) {
          setMsg(json?.error || "Could not load leaderboard.");
        }
        return;
      }

      applyLeaderboardData(json);
      try {
        window.sessionStorage.setItem(cacheKey, JSON.stringify(json));
      } catch {
        // Ignore storage failures (e.g. private mode quota).
      }
      setMsg("");
    })();
  }, [season]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(max-width: 640px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  const activeSortBy: SortKey = sortBy;
  const activeSortDirection: SortDirection = sortDirection;

  const rankColWidth = isMobile ? 56 : 68;
  const tipsterColWidth = isMobile ? 148 : 188;
  const tableMinWidth = isMobile ? 860 : 1000;

  function stickyColumnStyle(col: 1 | 2, isHeader: boolean) {
    return {
      position: "sticky" as const,
      left: col === 1 ? 0 : rankColWidth,
      zIndex: isHeader ? (col === 1 ? 20 : 19) : col === 1 ? 10 : 9,
      background: "var(--card)",
      width: col === 1 ? rankColWidth : tipsterColWidth,
      minWidth: col === 1 ? rankColWidth : tipsterColWidth,
      maxWidth: col === 1 ? rankColWidth : tipsterColWidth,
      backgroundClip: "padding-box",
      overflow: "hidden",
      boxShadow:
        col === 2
          ? "3px 0 0 var(--card), 4px 0 0 var(--border)"
          : "1px 0 0 var(--border)",
    };
  }

  const sortedRows = useMemo(() => {
    const list = [...rows];

    list.sort((a, b) => {
      let primaryCmp = 0;

      if (activeSortBy === "display_name") {
        primaryCmp = a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
      } else {
        primaryCmp = numericSortValue(a, activeSortBy) - numericSortValue(b, activeSortBy);
      }

      const directionalPrimary = activeSortDirection === "asc" ? primaryCmp : -primaryCmp;
      if (directionalPrimary !== 0) {
        return directionalPrimary;
      }

      // Keep season rank as a stable reference when values tie.
      const rankTieBreak = a.rank - b.rank;
      if (rankTieBreak !== 0) {
        return rankTieBreak;
      }

      return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
    });

    return list;
  }, [rows, activeSortBy, activeSortDirection]);

  function onSort(nextKey: SortKey) {
    if (sortBy === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(nextKey);
    setSortDirection(DEFAULT_SORT_DIR[nextKey]);
  }

  function sortMarker(key: SortKey) {
    if (activeSortBy !== key) return "↑↓";
    return activeSortDirection === "asc" ? "↑" : "↓";
  }

  function sortableHeader(label: string, key: SortKey, stickyCol?: 1 | 2, width?: number) {
    return (
      <UiTableHeadCell
        style={{
          ...(stickyCol ? stickyColumnStyle(stickyCol, true) : {}),
          ...(width
            ? {
                width,
                minWidth: width,
                maxWidth: width,
              }
            : {}),
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
            fontWeight: activeSortBy === key ? 800 : 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: 0,
            whiteSpace: "nowrap",
          }}
          title={`Sort by ${label}`}
        >
          <span>{label}</span>
          <span style={{ opacity: sortBy === key ? 1 : 0.45, fontSize: 11, letterSpacing: -0.3 }}>
            {sortMarker(key)}
          </span>
        </button>
      </UiTableHeadCell>
    );
  }

  return (
    <main className="ui-page ui-page--wide">
      <h1 className="ui-title">Leaderboard • {season}</h1>

      {msg && <p className="ui-caption ui-mt-4">{msg}</p>}

      {!msg && (
        <>
          <UiTableShell className="ui-mt-3">
            {rows.length === 0 ? (
              <div style={{ padding: 16 }} className="ui-caption">No leaderboard data yet.</div>
            ) : (
              <UiTableScroll>
                <table className={`ui-table ${isMobile ? "ui-table--compact" : ""}`} style={{ minWidth: tableMinWidth }}>
                  <thead>
                    <tr className="ui-table-head-row">
                      {sortableHeader("Rank", "rank", 1)}
                      {sortableHeader("Name", "display_name", 2)}
                      {sortableHeader("Total Pts", "total_points", undefined, 92)}
                      {sortableHeader("Behind", "behind_leader", undefined, 84)}
                      {sortableHeader("Move", "movement", undefined, 74)}
                      {sortableHeader("Accuracy", "accuracy_pct", undefined, 90)}
                      {sortableHeader("Streak", "current_streak", undefined, 68)}
                      {sortableHeader("Avg Odds", "avg_winning_odds", undefined, 88)}
                      {sortableHeader("Correct", "correct_tips", undefined, 72)}
                      {sortableHeader("Current Round", "round_score", undefined, 112)}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => (
                      <tr key={r.user_id}>
                        <UiTableCell
                          style={{
                            fontWeight: 900,
                            ...stickyColumnStyle(1, false),
                          }}
                        >
                          #{r.rank}
                        </UiTableCell>
                        <UiTableCell
                          style={{
                            fontWeight: 700,
                            ...stickyColumnStyle(2, false),
                          }}
                          title={
                            r.payment_status === "pending"
                              ? `${r.display_name} (unpaid)`
                              : r.display_name
                          }
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <UnpaidTag paymentStatus={r.payment_status ?? null} compact={isMobile} />
                            <span
                              style={{
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                display: "block",
                              }}
                            >
                              {r.display_name}
                            </span>
                            <ChampionCrown isChampion={r.user_id === reigningChampionUserId} />
                          </span>
                        </UiTableCell>
                        <UiTableCell style={{ fontWeight: 800, width: 92, minWidth: 92 }}>
                          {fmtPts(r.total_points)}
                        </UiTableCell>
                        <UiTableCell style={{ width: 84, minWidth: 84 }}>
                          {r.behind_leader <= 0 ? "-" : fmtPts(r.behind_leader)}
                        </UiTableCell>
                        <UiTableCell
                          style={{
                            width: 74,
                            minWidth: 74,
                            color: movementColor(r.movement),
                            fontWeight: 800,
                          }}
                          title={r.previous_rank ? `Previously #${r.previous_rank}` : "No previous round baseline"}
                        >
                          {movementText(r.movement)}
                        </UiTableCell>
                        <UiTableCell style={{ width: 90, minWidth: 90 }}>
                          {fmtPct(r.accuracy_pct)}
                        </UiTableCell>
                        <UiTableCell style={{ width: 68, minWidth: 68 }}>
                          {r.current_streak}
                        </UiTableCell>
                        <UiTableCell style={{ width: 88, minWidth: 88 }}>
                          {fmtPts(r.avg_winning_odds)}
                        </UiTableCell>
                        <UiTableCell style={{ width: 72, minWidth: 72 }}>
                          {r.correct_tips}
                        </UiTableCell>
                        <UiTableCell style={{ fontWeight: 700, width: 112, minWidth: 112 }}>
                          {fmtPts(r.round_score)}
                        </UiTableCell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </UiTableScroll>
            )}
          </UiTableShell>
        </>
      )}
    </main>
  );
}
