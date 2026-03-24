"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UnpaidTag } from "@/components/UnpaidTag";
import { ChampionCrown } from "@/components/ChampionCrown";
import { UiCard, UiTableCell, UiTableHeadCell, UiTableScroll, UiTableShell } from "@/components/ui";

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
  scored_rounds?: number[];
  rank_trends?: LeaderboardTrendSeries[];
  rows: LeaderboardRow[];
  error?: string;
};

type LeaderboardTrendPoint = {
  round_number: number;
  rank: number;
  total_points: number;
};

type LeaderboardTrendSeries = {
  user_id: string;
  display_name: string;
  payment_status?: string | null;
  points: LeaderboardTrendPoint[];
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
type TrendMetric = "rank" | "points";

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

const TREND_COLORS = [
  "#0f766e",
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#4f46e5",
  "#65a30d",
  "#ea580c",
  "#475569",
];

function hashString(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function colorForUser(userId: string) {
  return TREND_COLORS[hashString(userId) % TREND_COLORS.length];
}

function buildNiceNumberTicks(maxValue: number, targetTickCount = 6) {
  const safeMax = Number.isFinite(maxValue) ? Math.max(0, maxValue) : 0;
  if (safeMax <= 0) return { ticks: [0, 1], axisMax: 1 };

  const roughStep = safeMax / Math.max(2, targetTickCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const residual = roughStep / magnitude;
  let niceResidual = 1;
  if (residual > 1) niceResidual = 2;
  if (residual > 2) niceResidual = 5;
  if (residual > 5) niceResidual = 10;
  const step = niceResidual * magnitude;
  const axisMax = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= axisMax + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(2)));
  }
  return { ticks, axisMax };
}

function TrendChart(props: {
  rounds: number[];
  selectedSeries: LeaderboardTrendSeries[];
  totalParticipants: number;
  metric: TrendMetric;
}) {
  const { rounds, selectedSeries, totalParticipants, metric } = props;
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null);
  const activeHoveredUserId = selectedSeries.some((series) => series.user_id === hoveredUserId)
    ? hoveredUserId
    : null;
  const isRankMode = metric === "rank";

  if (rounds.length === 0) {
    return (
      <div className="ui-caption" style={{ padding: 12 }}>
        Position trend appears once at least one round has been scored.
      </div>
    );
  }

  if (selectedSeries.length === 0) {
    return (
      <div className="ui-caption" style={{ padding: 12 }}>
        Select at least one tipster to draw the chart.
      </div>
    );
  }

  const width = 980;
  const height = 360;
  const margin = { top: 20, right: 20, bottom: 40, left: 42 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const maxRankInSeries = Math.max(
    1,
    ...selectedSeries.flatMap((series) => series.points.map((point) => point.rank))
  );
  const rankMax = Math.max(1, totalParticipants, maxRankInSeries);
  const maxPointsInSeries = Math.max(
    0,
    ...selectedSeries.flatMap((series) => series.points.map((point) => point.total_points))
  );
  const pointTicksData = buildNiceNumberTicks(maxPointsInSeries);

  const minRound = rounds[0];
  const maxRound = rounds[rounds.length - 1];
  const roundRange = Math.max(1, maxRound - minRound);
  const rankRange = Math.max(1, rankMax - 1);
  const pointsRange = Math.max(1, pointTicksData.axisMax);

  const x = (roundNumber: number) =>
    margin.left + ((roundNumber - minRound) / roundRange) * innerWidth;
  const y = (value: number) => {
    if (isRankMode) {
      return margin.top + ((value - 1) / rankRange) * innerHeight;
    }
    return margin.top + (1 - value / pointsRange) * innerHeight;
  };

  const maxRoundTicks = 9;
  const roundTickStep = Math.max(1, Math.ceil(rounds.length / maxRoundTicks));
  const xTicks = rounds.filter(
    (_roundNumber, index) => index % roundTickStep === 0 || index === rounds.length - 1
  );

  const yTicksSet = new Set<number>(isRankMode ? [1, rankMax] : pointTicksData.ticks);
  if (isRankMode) {
    const yTickStep = rankMax <= 12 ? 2 : rankMax <= 24 ? 4 : 5;
    for (let rank = yTickStep; rank < rankMax; rank += yTickStep) {
      yTicksSet.add(rank);
    }
  }
  const yTicks = Array.from(yTicksSet).sort((a, b) => a - b);
  const chartAriaLabel = isRankMode ? "Leaderboard position trend" : "Leaderboard points trend";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="ui-caption">
        {isRankMode
          ? "Round-by-round ladder position (1 = top)."
          : "Round-by-round total points."}
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 8 }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" aria-label={chartAriaLabel}>
          <rect x={0} y={0} width={width} height={height} fill="var(--card)" />

          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={margin.left - 8}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--muted)"
              >
                {isRankMode ? `#${tick}` : fmtPts(tick)}
              </text>
            </g>
          ))}

          {xTicks.map((tick) => (
            <g key={`x-${tick}`}>
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={margin.top}
                y2={height - margin.bottom}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={x(tick)}
                y={height - margin.bottom + 18}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted)"
              >
                R{tick}
              </text>
            </g>
          ))}

          {selectedSeries.map((series) => {
            const pointByRound = new Map(series.points.map((point) => [point.round_number, point]));
            const orderedPoints = rounds
              .map((roundNumber) => pointByRound.get(roundNumber))
              .filter((point): point is LeaderboardTrendPoint => Boolean(point));
            if (orderedPoints.length === 0) return null;

            const pathData = orderedPoints
              .map((point, index) => {
                const command = index === 0 ? "M" : "L";
                const yValue = isRankMode ? point.rank : point.total_points;
                return `${command} ${x(point.round_number).toFixed(2)} ${y(yValue).toFixed(2)}`;
              })
              .join(" ");

            const isActive =
              activeHoveredUserId === null || activeHoveredUserId === series.user_id;
            const stroke = isActive ? colorForUser(series.user_id) : "var(--muted)";
            const lastPoint = orderedPoints[orderedPoints.length - 1];
            return (
              <g key={series.user_id}>
                <path
                  d={pathData}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity={isActive ? 1 : 0.38}
                  strokeWidth={isActive ? 2.8 : 2.1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle
                  cx={x(lastPoint.round_number)}
                  cy={y(isRankMode ? lastPoint.rank : lastPoint.total_points)}
                  r={4}
                  fill={stroke}
                  opacity={isActive ? 1 : 0.45}
                  stroke="var(--card)"
                  strokeWidth={1.5}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {selectedSeries.map((series) => {
          const latest = series.points[series.points.length - 1];
          const isActive =
            activeHoveredUserId === null || activeHoveredUserId === series.user_id;
          const isHovered = activeHoveredUserId === series.user_id;
          return (
            <button
              type="button"
              key={`legend-${series.user_id}`}
              onMouseEnter={() => setHoveredUserId(series.user_id)}
              onMouseLeave={() => setHoveredUserId(null)}
              onFocus={() => setHoveredUserId(series.user_id)}
              onBlur={() => setHoveredUserId(null)}
              title="Highlight this tipster on chart"
              style={{
                appearance: "none",
                background: "var(--card)",
                color: "var(--foreground)",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                border: `1px solid ${isHovered ? colorForUser(series.user_id) : "var(--border)"}`,
                borderRadius: 999,
                padding: "5px 10px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                opacity: isActive ? 1 : 0.62,
                transition: "opacity 120ms ease, border-color 120ms ease",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  background: colorForUser(series.user_id),
                }}
              />
              <span>{series.display_name}</span>
              <span className="ui-caption" style={{ fontSize: 12 }}>
                {isRankMode ? `#${latest?.rank ?? "-"}` : `${fmtPts(latest?.total_points ?? 0)} pts`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [reigningChampionUserId, setReigningChampionUserId] = useState<string | null>(null);
  const [trendRounds, setTrendRounds] = useState<number[]>([]);
  const [trendSeries, setTrendSeries] = useState<LeaderboardTrendSeries[]>([]);
  const [selectedTrendUserIds, setSelectedTrendUserIds] = useState<string[]>([]);
  const [trendSearch, setTrendSearch] = useState("");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("rank");
  const [msg, setMsg] = useState("Loading...");
  const [sortBy, setSortBy] = useState<SortKey>("total_points");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isMobile, setIsMobile] = useState(false);

  function applyLeaderboardData(json: LeaderboardResponse) {
    const nextRows = Array.isArray(json.rows) ? json.rows : [];
    setRows(nextRows);
    setReigningChampionUserId(
      typeof json.reigning_champion_user_id === "string"
        ? json.reigning_champion_user_id
        : null
    );

    const nextRounds = Array.isArray(json.scored_rounds)
      ? json.scored_rounds
          .map((roundNumber) => Number(roundNumber))
          .filter((roundNumber) => Number.isFinite(roundNumber))
          .sort((a, b) => a - b)
      : [];

    const nextTrends = Array.isArray(json.rank_trends)
      ? json.rank_trends.map((series) => ({
          user_id: String(series.user_id),
          display_name: String(series.display_name ?? ""),
          payment_status: series.payment_status ?? null,
          points: Array.isArray(series.points)
            ? series.points
                .map((point) => ({
                  round_number: Number(point.round_number),
                  rank: Number(point.rank),
                  total_points: Number(point.total_points),
                }))
                .filter(
                  (point) =>
                    Number.isFinite(point.round_number) &&
                    Number.isFinite(point.rank) &&
                    Number.isFinite(point.total_points)
                )
                .sort((a, b) => a.round_number - b.round_number)
            : [],
        }))
      : [];

    setTrendRounds(nextRounds);
    setTrendSeries(nextTrends);

    setSelectedTrendUserIds((prev) => {
      const validIds = new Set(nextTrends.map((series) => series.user_id));
      const kept = prev.filter((userId) => validIds.has(userId));
      if (kept.length > 0) return kept;
      return nextRows
        .slice(0, 5)
        .map((row) => row.user_id)
        .filter((userId) => validIds.has(userId));
    });
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
  const rankByUserId = useMemo(
    () => new Map(rows.map((row) => [row.user_id, row.rank])),
    [rows]
  );

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

  const filteredTrendOptions = useMemo(() => {
    const query = trendSearch.trim().toLowerCase();
    const list = query
      ? trendSeries.filter((series) => series.display_name.toLowerCase().includes(query))
      : trendSeries;
    return [...list].sort((a, b) => {
      const rankA = rankByUserId.get(a.user_id) ?? Number.MAX_SAFE_INTEGER;
      const rankB = rankByUserId.get(b.user_id) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
    });
  }, [trendSeries, trendSearch, rankByUserId]);

  const selectedTrendSeries = useMemo(() => {
    const byUserId = new Map(trendSeries.map((series) => [series.user_id, series]));
    return selectedTrendUserIds
      .map((userId) => byUserId.get(userId))
      .filter((series): series is LeaderboardTrendSeries => Boolean(series));
  }, [trendSeries, selectedTrendUserIds]);

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

  function toggleTrendUser(userId: string) {
    setSelectedTrendUserIds((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((existing) => existing !== userId);
      }
      return [...prev, userId];
    });
  }

  function selectTopTrendUsers(count: number) {
    const validIds = new Set(trendSeries.map((series) => series.user_id));
    const topIds = rows
      .slice(0, count)
      .map((row) => row.user_id)
      .filter((userId) => validIds.has(userId));
    setSelectedTrendUserIds(topIds);
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

          <UiCard className="ui-mt-3">
            <div style={{ padding: 16, display: "grid", gap: 14 }}>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  justifyContent: "space-between",
                  alignItems: isMobile ? "flex-start" : "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <h2 style={{ margin: 0, fontSize: 30, lineHeight: 1.1 }}>Position Trend</h2>
                  <p className="ui-caption" style={{ margin: 0 }}>
                    Compare leaderboard rank or total points across completed rounds. Select
                    multiple tipsters to track head-to-head movement.
                  </p>
                </div>
                <div
                  role="group"
                  aria-label="Trend metric"
                  style={{
                    display: "inline-flex",
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    overflow: "hidden",
                    background: "var(--card)",
                  }}
                >
                  {(["rank", "points"] as const).map((option) => {
                    const isActive = trendMetric === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setTrendMetric(option)}
                        style={{
                          appearance: "none",
                          border: "none",
                          padding: "6px 12px",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 700,
                          background: isActive ? "var(--foreground)" : "transparent",
                          color: isActive ? "var(--background)" : "var(--foreground)",
                        }}
                        aria-pressed={isActive}
                      >
                        {option === "rank" ? "Rank" : "Points"}
                      </button>
                    );
                  })}
                </div>
              </div>

              {trendSeries.length === 0 || trendRounds.length === 0 ? (
                <p className="ui-caption" style={{ margin: 0 }}>
                  Trend data appears after rounds are scored.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  <TrendChart
                    rounds={trendRounds}
                    selectedSeries={selectedTrendSeries}
                    totalParticipants={rows.length}
                    metric={trendMetric}
                  />

                  <div style={{ display: "grid", gap: 10 }}>
                    <input
                      value={trendSearch}
                      onChange={(event) => setTrendSearch(event.target.value)}
                      placeholder="Search tipsters..."
                      className="ui-input"
                      aria-label="Search tipsters"
                    />

                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        maxHeight: isMobile ? 220 : 260,
                        overflow: "auto",
                        background: "var(--background)",
                      }}
                    >
                      {filteredTrendOptions.map((series) => {
                        const checked = selectedTrendUserIds.includes(series.user_id);
                        const rank = rankByUserId.get(series.user_id);
                        return (
                          <label
                            key={`picker-${series.user_id}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "9px 10px",
                              borderBottom: "1px solid var(--border)",
                              cursor: "pointer",
                              fontSize: 14,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTrendUser(series.user_id)}
                              aria-label={`Toggle ${series.display_name}`}
                            />
                            <span
                              aria-hidden
                              style={{
                                width: 9,
                                height: 9,
                                borderRadius: 999,
                                background: colorForUser(series.user_id),
                              }}
                            />
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {series.display_name}
                            </span>
                            <span className="ui-caption" style={{ fontSize: 12 }}>
                              {rank ? `#${rank}` : ""}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => selectTopTrendUsers(5)}
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--card)",
                          color: "var(--foreground)",
                          borderRadius: 999,
                          padding: "6px 12px",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        Top 5
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedTrendUserIds(trendSeries.map((series) => series.user_id))
                        }
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--card)",
                          color: "var(--foreground)",
                          borderRadius: 999,
                          padding: "6px 12px",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedTrendUserIds([])}
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--card)",
                          color: "var(--foreground)",
                          borderRadius: 999,
                          padding: "6px 12px",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </UiCard>
        </>
      )}
    </main>
  );
}
