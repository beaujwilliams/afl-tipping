"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChampionSeasonLabels } from "@/components/ChampionSeasonLabels";
import { UnpaidTag } from "@/components/UnpaidTag";
import { normalizeChampionSeasonsByUserId } from "@/lib/champion-metadata";
import { getRoundDisplayName } from "@/lib/round-label";
import { waitForSession } from "@/lib/session-client";
import type {
  MatchResultRow,
  PlayerRoundScore,
  RoundResultsResponse,
} from "@/lib/round-results-data";
import {
  UiButtonLink,
  UiCard,
  UiCardGrid,
  UiSkeleton,
  UiTableCell,
  UiTableHeadCell,
  UiTableScroll,
  UiTableShell,
} from "@/components/ui";

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

type RoundSortKey =
  | "rank"
  | "display_name"
  | "round_score"
  | "correct_tips"
  | "accuracy_pct"
  | "avg_correct_odds"
  | "potential_score"
  | "difference_score";

type SortDirection = "asc" | "desc";
type MyTipStatus = "correct" | "incorrect" | "pending" | "missed";

type MyTipSummaryRow = {
  match_id: string;
  match_label: string;
  home_team: string;
  away_team: string;
  picked: string | null;
  opponent: string | null;
  status: MyTipStatus;
};

type RoundResultsDetailPageClientProps = {
  season: number;
  round: number;
  currentUserId: string | null;
  initialData: RoundResultsResponse | null;
  initialMessage?: string | null;
};

const DEFAULT_SORT_DIR: Record<RoundSortKey, SortDirection> = {
  rank: "asc",
  display_name: "asc",
  round_score: "desc",
  correct_tips: "desc",
  accuracy_pct: "desc",
  avg_correct_odds: "desc",
  potential_score: "desc",
  difference_score: "desc",
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

function fmtOdds(n: number | null | undefined) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v.toFixed(2);
}

function pctBar(pct: number) {
  const safe = Math.max(0, Math.min(100, Number(pct) || 0));
  return `${safe}%`;
}

function myTipStatusLabel(status: MyTipStatus) {
  if (status === "correct") return "Correct";
  if (status === "incorrect") return "Incorrect";
  if (status === "missed") return "Missed";
  return "Pending";
}

function myTipStatusClassName(status: MyTipStatus) {
  if (status === "correct") return "ui-badge ui-badge--success";
  if (status === "incorrect" || status === "missed") return "ui-badge ui-badge--danger";
  return "ui-badge ui-badge--info";
}

function RoundResultsLoadingSkeleton({ isMobile }: { isMobile: boolean }) {
  return (
    <div className="ui-grid ui-mt-4" style={{ gap: 14 }}>
      <UiCardGrid columns={2} style={{ gap: 10 }}>
        {Array.from({ length: 2 }).map((_, index) => (
          <UiCard key={`round-results-metric-skeleton-${index}`} soft>
            <UiSkeleton width="42%" height={12} />
            <UiSkeleton width="34%" height={26} className="ui-mt-2" />
          </UiCard>
        ))}
      </UiCardGrid>

      <UiCard soft>
        <div className="ui-grid" style={{ gap: 10 }}>
          <UiSkeleton width="32%" height={16} />
          <UiSkeleton width="48%" height={12} />
          <div className="ui-grid" style={{ gap: 8 }}>
            {Array.from({ length: isMobile ? 4 : 5 }).map((_, index) => (
              <div
                key={`round-results-summary-skeleton-${index}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <UiSkeleton width={index % 2 === 0 ? "42%" : "36%"} height={16} />
                <UiSkeleton width={76} height={24} radius={999} />
              </div>
            ))}
          </div>
        </div>
      </UiCard>

      <UiTableShell>
        <UiTableScroll>
          <table className={`ui-table ${isMobile ? "ui-table--compact" : ""}`} style={{ minWidth: isMobile ? 760 : 920 }}>
            <thead>
              <tr className="ui-table-head-row">
                <UiTableHeadCell>Rank</UiTableHeadCell>
                <UiTableHeadCell>Name</UiTableHeadCell>
                <UiTableHeadCell>Score</UiTableHeadCell>
                <UiTableHeadCell>Correct</UiTableHeadCell>
                <UiTableHeadCell>Accuracy</UiTableHeadCell>
                <UiTableHeadCell>Avg Odds</UiTableHeadCell>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, index) => (
                <tr key={`round-results-table-skeleton-${index}`}>
                  <UiTableCell><UiSkeleton width={36} height={20} /></UiTableCell>
                  <UiTableCell><UiSkeleton width={index === 0 ? 156 : 132} height={20} /></UiTableCell>
                  <UiTableCell><UiSkeleton width={54} height={20} /></UiTableCell>
                  <UiTableCell><UiSkeleton width={34} height={20} /></UiTableCell>
                  <UiTableCell><UiSkeleton width={56} height={20} /></UiTableCell>
                  <UiTableCell><UiSkeleton width={46} height={20} /></UiTableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </UiTableScroll>
      </UiTableShell>
    </div>
  );
}

function RoundRecapLoadingSkeleton() {
  return (
    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
      <UiSkeleton width="28%" height={12} />
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 12,
          background: "var(--card)",
          display: "grid",
          gap: 10,
        }}
      >
        <UiSkeleton width="24%" height={16} />
        <UiSkeleton width="100%" height={12} />
        <UiSkeleton width="94%" height={12} />
        <UiSkeleton width="88%" height={12} />
        <UiSkeleton width="62%" height={12} />
      </div>
    </div>
  );
}

export default function RoundResultsDetailPageClient({
  season,
  round,
  currentUserId,
  initialData,
  initialMessage = null,
}: RoundResultsDetailPageClientProps) {
  const msg = initialMessage ?? "";
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isRecapAdmin, setIsRecapAdmin] = useState(false);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState("");
  const [roundRecap, setRoundRecap] = useState<RecapRow | null>(null);
  const [sortBy, setSortBy] = useState<RoundSortKey>("round_score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isMobile, setIsMobile] = useState(false);
  const [everyoneTipsSearch, setEveryoneTipsSearch] = useState("");
  const [expandedEveryoneTipUserIds, setExpandedEveryoneTipUserIds] = useState<
    Record<string, boolean>
  >({});
  const everyoneTipsRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const invalidParams = !Number.isFinite(season) || !Number.isFinite(round);
  const matches = useMemo<MatchResultRow[]>(
    () => (Array.isArray(initialData?.matches) ? initialData.matches : []),
    [initialData]
  );
  const players = useMemo<PlayerRoundScore[]>(
    () => (Array.isArray(initialData?.players) ? initialData.players : []),
    [initialData]
  );
  const championHighlightUserIds = useMemo(() => {
    const championIds = Array.isArray(initialData?.champion_highlight_user_ids)
      ? initialData.champion_highlight_user_ids
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
      : [];
    const reigningChampionUserId =
      typeof initialData?.reigning_champion_user_id === "string"
        ? initialData.reigning_champion_user_id.trim()
        : "";
    if (reigningChampionUserId && !championIds.includes(reigningChampionUserId)) {
      championIds.unshift(reigningChampionUserId);
    }
    return Array.from(new Set(championIds));
  }, [initialData]);
  const championSeasonsByUserId = useMemo(
    () => normalizeChampionSeasonsByUserId(initialData?.champion_seasons_by_user_id),
    [initialData]
  );
  const lockTimeUtc = initialData?.lock_time_utc ?? null;
  const showRoundResultsSkeleton =
    !!msg &&
    (msg.startsWith("Checking") || msg.startsWith("Loading")) &&
    matches.length === 0 &&
    players.length === 0;

  useEffect(() => {
    let alive = true;

    (async () => {
      if (invalidParams || !initialData) return;

      setIsRecapAdmin(false);
      setRecapLoading(false);
      setRecapError("");
      setRoundRecap(null);
      setEveryoneTipsSearch("");
      setExpandedEveryoneTipUserIds({});

      const session = await waitForSession(3000, 180);
      if (!alive || !session) return;

      try {
        setRecapLoading(true);
        const recapRes = await fetch(
          `/api/admin/round-recaps?season=${encodeURIComponent(String(season))}&round=${encodeURIComponent(
            String(round)
          )}&limit=1`,
          {
            cache: "no-store",
            headers: { Authorization: `Bearer ${session.access_token}` },
          }
        );

        if (!alive) return;

        if (recapRes.status !== 401 && recapRes.status !== 403) {
          setIsRecapAdmin(true);
          const recapJson = (await recapRes.json().catch(() => null)) as RecapsResponse | null;
          if (!recapRes.ok) {
            const parts = [recapJson?.error ?? "Could not load round recap."];
            if (recapJson?.details) parts.push(recapJson.details);
            if (recapJson?.hint) parts.push(recapJson.hint);
            setRecapError(parts.join(" - "));
          } else {
            const rows = Array.isArray(recapJson?.recaps) ? recapJson.recaps : [];
            setRoundRecap(rows[0] ?? null);
          }
        }
      } catch {
        if (!alive) return;
        setRecapError("Could not load round recap.");
      } finally {
        if (alive) setRecapLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [initialData, invalidParams, round, season]);

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

  const activeSortBy: RoundSortKey = sortBy;
  const activeSortDirection: SortDirection = sortDirection;
  const championHighlightSet = useMemo(
    () => new Set(championHighlightUserIds),
    [championHighlightUserIds]
  );
  const rankColWidth = isMobile ? 56 : 68;
  const tipsterColWidth = isMobile ? 148 : 188;
  const tableMinWidth = isMobile ? 760 : 900;

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

  const finishedMatches = useMemo(() => {
    return matches.filter((m) => !!String(m.winner_team ?? "").trim()).length;
  }, [matches]);

  const submittedTipsters = useMemo(() => {
    return players.filter((p) => Number(p.total_tips ?? 0) > 0).length;
  }, [players]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const isRoundLocked = useMemo(() => {
    if (!lockTimeUtc) return false;
    const ms = new Date(lockTimeUtc).getTime();
    if (Number.isNaN(ms)) return false;
    return nowMs >= ms;
  }, [lockTimeUtc, nowMs]);

  const myRoundRow = useMemo(() => {
    if (!currentUserId) return null;
    return players.find((p) => p.user_id === currentUserId) ?? null;
  }, [players, currentUserId]);

  const myTipRows = useMemo<MyTipSummaryRow[]>(() => {
    return matches.map((m) => {
      const picked = myRoundRow?.picks?.[m.id] ?? null;
      const opponent = picked
        ? picked === m.home_team
          ? m.away_team
          : picked === m.away_team
            ? m.home_team
            : null
        : null;
      const winner = String(m.winner_team ?? "").trim();
      let status: MyTipStatus = "pending";

      if (winner) {
        if (!picked) status = "missed";
        else status = picked === winner ? "correct" : "incorrect";
      }

      return {
        match_id: m.id,
        match_label: `${m.home_team} vs ${m.away_team}`,
        home_team: m.home_team,
        away_team: m.away_team,
        picked,
        opponent,
        status,
      };
    });
  }, [matches, myRoundRow]);

  const myCompletedTipRows = useMemo(
    () => myTipRows.filter((row) => row.status !== "pending"),
    [myTipRows]
  );

  const myUpcomingTipRows = useMemo(
    () => myTipRows.filter((row) => row.status === "pending"),
    [myTipRows]
  );

  const myCorrectSoFar = useMemo(
    () => myTipRows.filter((row) => row.status === "correct").length,
    [myTipRows]
  );

  const matchTitleById = useMemo(() => {
    const out: Record<string, string> = {};
    matches.forEach((m) => {
      out[m.id] = `${m.home_team} vs ${m.away_team}`;
    });
    return out;
  }, [matches]);

  const everyoneTipsRows = useMemo(() => {
    const sorted = [...players].sort((a, b) => {
      const potentialDiff = Number(b.potential_score ?? 0) - Number(a.potential_score ?? 0);
      if (potentialDiff !== 0) return potentialDiff;
      return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
    });

    return sorted.map((p, index) => {
      let picksCount = 0;
      let underdogCount = 0;

      matches.forEach((m) => {
        const team = String(p.picks?.[m.id] ?? "").trim();
        if (!team) return;
        picksCount += 1;

        const homeOdds = Number(m.home_odds ?? 0);
        const awayOdds = Number(m.away_odds ?? 0);
        const pickedOdds = team === m.home_team ? homeOdds : team === m.away_team ? awayOdds : 0;
        const otherOdds = team === m.home_team ? awayOdds : team === m.away_team ? homeOdds : 0;
        if (pickedOdds > 0 && otherOdds > 0 && pickedOdds > otherOdds) underdogCount += 1;
      });

      return {
        ...p,
        row_rank: index + 1,
        picks_count: picksCount,
        underdog_count: underdogCount,
      };
    });
  }, [players, matches]);

  const visibleEveryoneTips = useMemo(() => {
    const q = everyoneTipsSearch.trim().toLowerCase();
    if (!q) return everyoneTipsRows;
    return everyoneTipsRows.filter((p) => {
      const name = String(p.display_name ?? "").toLowerCase();
      const id = String(p.user_id).toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [everyoneTipsRows, everyoneTipsSearch]);

  const allVisibleExpanded =
    visibleEveryoneTips.length > 0 &&
    visibleEveryoneTips.every((p) => !!expandedEveryoneTipUserIds[p.user_id]);

  function jumpToMyTips() {
    if (!currentUserId) return;
    const me = everyoneTipsRows.find((p) => p.user_id === currentUserId);
    if (!me) return;

    setEveryoneTipsSearch("");
    setExpandedEveryoneTipUserIds((prev) => ({ ...prev, [currentUserId]: true }));

    setTimeout(() => {
      const node = everyoneTipsRowRefs.current[currentUserId];
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  function toggleExpandAllVisible() {
    if (!visibleEveryoneTips.length) return;
    setExpandedEveryoneTipUserIds((prev) => {
      const next = { ...prev };
      if (allVisibleExpanded) {
        visibleEveryoneTips.forEach((p) => {
          delete next[p.user_id];
        });
      } else {
        visibleEveryoneTips.forEach((p) => {
          next[p.user_id] = true;
        });
      }
      return next;
    });
  }

  const pickListsByMatchId = useMemo(() => {
    const out: Record<string, { home: string[]; away: string[] }> = {};

    matches.forEach((m) => {
      out[m.id] = { home: [], away: [] };
    });

    players.forEach((p) => {
      const displayName = String(p.display_name ?? "").trim() || "(no display name)";

      matches.forEach((m) => {
        const picked = String(p.picks?.[m.id] ?? "").trim();
        if (!picked) return;

        if (picked === m.home_team) {
          out[m.id]?.home.push(displayName);
          return;
        }

        if (picked === m.away_team) {
          out[m.id]?.away.push(displayName);
        }
      });
    });

    Object.values(out).forEach((bucket) => {
      bucket.home.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
      bucket.away.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    });

    return out;
  }, [matches, players]);

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
    const dir = activeSortDirection === "asc" ? 1 : -1;

    list.sort((a, b) => {
      let primaryCmp = 0;

      if (activeSortBy === "display_name") {
        primaryCmp = a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
      } else if (activeSortBy === "rank") {
        const aRank = roundRankByUserId[a.user_id] ?? Number.MAX_SAFE_INTEGER;
        const bRank = roundRankByUserId[b.user_id] ?? Number.MAX_SAFE_INTEGER;
        primaryCmp = aRank - bRank;
      } else if (activeSortBy === "round_score") {
        primaryCmp = a.round_score - b.round_score;
      } else if (activeSortBy === "correct_tips") {
        primaryCmp = a.correct_tips - b.correct_tips;
      } else if (activeSortBy === "accuracy_pct") {
        primaryCmp = a.accuracy_pct - b.accuracy_pct;
      } else if (activeSortBy === "potential_score") {
        primaryCmp = a.potential_score - b.potential_score;
      } else if (activeSortBy === "difference_score") {
        primaryCmp = a.difference_score - b.difference_score;
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
  }, [players, roundRankByUserId, activeSortBy, activeSortDirection]);

  function onSort(nextKey: RoundSortKey) {
    if (sortBy === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(nextKey);
    setSortDirection(DEFAULT_SORT_DIR[nextKey]);
  }

  function sortMarker(key: RoundSortKey) {
    if (activeSortBy !== key) return "↑↓";
    return activeSortDirection === "asc" ? "↑" : "↓";
  }

  return (
    <main className="ui-page ui-page--narrow">
      <div className="ui-row-between-start">
        <div>
          <h1 className="ui-title--section" style={{ margin: 0, fontSize: 30, letterSpacing: -0.4 }}>
            {getRoundDisplayName(round)} Results
          </h1>
          <div className="ui-caption ui-mt-2">
            Season {season} • {lockTimeUtc ? `Locked ${formatMelbourne(lockTimeUtc)}` : "Lock time unavailable"}
          </div>
        </div>

        <UiButtonLink
          href={`/results/${season}`}
          style={{ alignSelf: "flex-start" }}
        >
          Back to rounds
        </UiButtonLink>
      </div>

      {invalidParams && <div className="ui-caption ui-mt-4">Invalid season/round.</div>}
      {!invalidParams && showRoundResultsSkeleton && (
        <RoundResultsLoadingSkeleton isMobile={isMobile} />
      )}
      {!invalidParams && !!msg && !showRoundResultsSkeleton && (
        <div className="ui-caption ui-mt-4">{msg}</div>
      )}

      {!invalidParams && !msg && (
        <>
          <UiCardGrid columns={2} className="ui-mt-4" style={{ gap: 10 }}>
            <UiCard soft>
              <div className="ui-kicker">Matches finished</div>
              <div style={{ marginTop: 5, fontSize: 22, fontWeight: 900 }}>
                {finishedMatches}/{matches.length}
              </div>
            </UiCard>

            <UiCard soft>
              <div className="ui-kicker">Submitted</div>
              <div style={{ marginTop: 5, fontSize: 22, fontWeight: 900 }}>
                {submittedTipsters}/{players.length}
              </div>
            </UiCard>
          </UiCardGrid>

          {!!matches.length && (
            <UiCard soft className="ui-mt-3">
              <div>
                <div style={{ fontWeight: 700 }}>
                  Correct so far: {myCorrectSoFar} / {matches.length}
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  Potential score: <b>{fmtPts(myRoundRow?.potential_score ?? 0)}</b>
                </div>
              </div>

              {isMobile ? (
                <>
                  {!!myCompletedTipRows.length && (
                    <div style={{ marginTop: 12 }}>
                      <div className="ui-kicker">Completed ({myCompletedTipRows.length})</div>
                      <div className="ui-grid ui-mt-2" style={{ gap: 7 }}>
                        {myCompletedTipRows.map((row) => (
                          <div
                            key={`my-tip-completed-${row.match_id}`}
                            style={{
                              fontSize: 13,
                              opacity: 0.95,
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              alignItems: "center",
                            }}
                          >
                            <div style={{ minWidth: 0, lineHeight: 1.35 }}>
                              {row.picked ? (
                                <div style={{ display: "grid", gap: 1 }}>
                                  <div style={{ fontWeight: 800 }}>{row.picked}</div>
                                  {row.opponent && (
                                    <div style={{ fontSize: 12, opacity: 0.68 }}>
                                      vs {row.opponent}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span style={{ opacity: 0.65 }}>No tip</span>
                              )}
                            </div>

                            <span
                              className={myTipStatusClassName(row.status)}
                              style={{ minWidth: 84, justifyContent: "center", flexShrink: 0 }}
                            >
                              {myTipStatusLabel(row.status)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!!myUpcomingTipRows.length && (
                    <div style={{ marginTop: 12 }}>
                      <div className="ui-kicker">Still to play ({myUpcomingTipRows.length})</div>
                      <div className="ui-grid ui-mt-2" style={{ gap: 7 }}>
                        {myUpcomingTipRows.map((row) => (
                          <div
                            key={`my-tip-upcoming-${row.match_id}`}
                            style={{
                              fontSize: 13,
                              opacity: 0.95,
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              alignItems: "center",
                            }}
                          >
                            <div style={{ minWidth: 0, lineHeight: 1.35 }}>
                              {row.picked ? (
                                <div style={{ display: "grid", gap: 1 }}>
                                  <div style={{ fontWeight: 800 }}>{row.picked}</div>
                                  {row.opponent && (
                                    <div style={{ fontSize: 12, opacity: 0.68 }}>
                                      vs {row.opponent}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span style={{ opacity: 0.65 }}>No tip</span>
                              )}
                            </div>

                            <span
                              className={myTipStatusClassName(row.status)}
                              style={{ minWidth: 84, justifyContent: "center", flexShrink: 0 }}
                            >
                              {myTipStatusLabel(row.status)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="ui-grid ui-mt-3" style={{ gap: 6 }}>
                  {myTipRows.map((row) => (
                    <div
                      key={`my-tip-${row.match_id}`}
                      style={{
                        fontSize: 13,
                        opacity: 0.92,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        {row.match_label} —{" "}
                        {row.picked ? (
                          <span>
                            tipped <b>{row.picked}</b>
                          </span>
                        ) : (
                          <span style={{ opacity: 0.6 }}>Not tipped</span>
                        )}
                      </div>

                      {row.status !== "pending" && (
                        <span className={myTipStatusClassName(row.status)}>
                          {myTipStatusLabel(row.status)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </UiCard>
          )}

          <UiTableShell className="ui-mt-3">
            <div className="ui-title--section" style={{ padding: "12px 12px 8px", fontSize: 15 }}>
              Round leaderboard
            </div>
            {players.length === 0 ? (
              <div style={{ padding: "0 12px 12px", opacity: 0.72, fontSize: 12 }}>No tips found for this round.</div>
            ) : isMobile ? (
              <div className="mobile-standings-list">
                {sortedPlayers.map((p) => {
                  const isChampion = championHighlightSet.has(p.user_id);
                  return (
                    <details key={p.user_id} className="mobile-standings-card">
                      <summary className="mobile-standings-summary">
                        <span className="mobile-standings-rank">
                          #{roundRankByUserId[p.user_id] ?? "-"}
                        </span>
                        <span className="mobile-standings-person">
                          <span className="mobile-standings-name-line">
                            <UnpaidTag paymentStatus={p.payment_status ?? null} compact />
                            <span
                              className="mobile-standings-name"
                              style={{ color: isChampion ? "var(--champion-gold)" : undefined }}
                            >
                              {p.display_name}
                            </span>
                            <ChampionSeasonLabels seasons={championSeasonsByUserId[p.user_id]} />
                          </span>
                          <span className="mobile-standings-meta">
                            {p.correct_tips} correct
                          </span>
                        </span>
                        <span className="mobile-standings-primary">
                          <strong>{fmtPts(p.round_score)}</strong>
                          <span>Score</span>
                        </span>
                      </summary>
                      <div className="mobile-standings-extra">
                        <div className="mobile-standings-stat">
                          <span>Potential</span>
                          <strong>{fmtPts(p.potential_score)}</strong>
                        </div>
                        <div className="mobile-standings-stat">
                          <span>Diff</span>
                          <strong>{fmtPts(p.difference_score)}</strong>
                        </div>
                        <div className="mobile-standings-stat">
                          <span>Avg odds</span>
                          <strong>{fmtPts(p.avg_correct_odds)}</strong>
                        </div>
                        <div className="mobile-standings-stat">
                          <span>Accuracy</span>
                          <strong>{fmtPct(p.accuracy_pct)}</strong>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : (
              <UiTableScroll>
                <table className={`ui-table ${isMobile ? "ui-table--compact" : ""}`} style={{ minWidth: tableMinWidth }}>
                  <thead>
                    <tr className="ui-table-head-row">
                      {([
                        ["Rank", "rank", 1, undefined],
                        ["Name", "display_name", 2, undefined],
                        [`R${round}`, "round_score", undefined, 84],
                        ["Correct", "correct_tips", undefined, 72],
                        ["Accuracy", "accuracy_pct", undefined, 88],
                        ["Avg Odds", "avg_correct_odds", undefined, 88],
                        ["Potential", "potential_score", undefined, 94],
                        ["Diff", "difference_score", undefined, 78],
                      ] as Array<[string, RoundSortKey, 1 | 2 | undefined, number | undefined]>).map(
                        ([label, key, stickyCol, width]) => (
                          <UiTableHeadCell
                            key={key}
                            style={{
                              ...(stickyCol ? stickyColumnStyle(stickyCol, true) : {}),
                              ...(width
                                ? {
                                    width,
                                    minWidth: width,
                                    maxWidth: width,
                                  }
                                : {}),
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
                                fontWeight: activeSortBy === key ? 800 : 600,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: 0,
                              }}
                            >
                              <span>{label}</span>
                              <span style={{ opacity: activeSortBy === key ? 1 : 0.45, fontSize: 11 }}>
                                {sortMarker(key)}
                              </span>
                            </button>
                          </UiTableHeadCell>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlayers.map((p) => {
                      const isChampion = championHighlightSet.has(p.user_id);
                      const rankSticky = stickyColumnStyle(1, false);
                      return (
                        <tr key={p.user_id}>
                          <UiTableCell
                            style={{
                              fontWeight: 900,
                              ...rankSticky,
                            }}
                          >
                            #{roundRankByUserId[p.user_id] ?? "-"}
                          </UiTableCell>
                          <UiTableCell
                            style={{ fontWeight: 700, ...stickyColumnStyle(2, false) }}
                            title={
                              p.payment_status === "pending"
                                ? `${p.display_name} (unpaid)`
                                : p.display_name
                            }
                          >
                            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                              <UnpaidTag paymentStatus={p.payment_status ?? null} compact={isMobile} />
                              <span
                                style={{
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  display: "block",
                                  color: isChampion ? "var(--champion-gold)" : undefined,
                                }}
                              >
                                {p.display_name}
                              </span>
                              <ChampionSeasonLabels seasons={championSeasonsByUserId[p.user_id]} />
                            </span>
                          </UiTableCell>
                          <UiTableCell style={{ fontWeight: 800, width: 84, minWidth: 84 }}>
                            {fmtPts(p.round_score)}
                          </UiTableCell>
                          <UiTableCell style={{ width: 72, minWidth: 72 }}>
                            {p.correct_tips}
                          </UiTableCell>
                          <UiTableCell style={{ width: 88, minWidth: 88 }}>
                            {fmtPct(p.accuracy_pct)}
                          </UiTableCell>
                          <UiTableCell style={{ width: 88, minWidth: 88 }}>
                            {fmtPts(p.avg_correct_odds)}
                          </UiTableCell>
                          <UiTableCell style={{ width: 94, minWidth: 94 }}>
                            {fmtPts(p.potential_score)}
                          </UiTableCell>
                          <UiTableCell style={{ width: 78, minWidth: 78 }}>
                            {fmtPts(p.difference_score)}
                          </UiTableCell>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </UiTableScroll>
            )}
          </UiTableShell>

          <div className="ui-grid ui-mt-4">
            {matches.map((m) => {
              const winner = String(m.winner_team ?? "").trim();
              const finished = !!winner;
              const picksForMatch = pickListsByMatchId[m.id] ?? { home: [], away: [] };
              const homeOddsLabel = fmtOdds(m.home_odds);
              const awayOddsLabel = fmtOdds(m.away_odds);

              return (
                <UiCard key={m.id}>
                  <div className="ui-kicker" style={{ fontSize: 11 }}>
                    {formatMelbourne(m.commence_time_utc)} • {normalizeVenue(m.venue)}
                  </div>

                  <div className="ui-row-between ui-mt-2">
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

                  <div className="ui-mt-3">
                    <div className="ui-grid" style={{ gap: 8 }}>
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
                          <span>
                            {m.home_team}
                            {homeOddsLabel ? ` (${homeOddsLabel})` : ""}
                          </span>
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
                          <span>
                            {m.away_team}
                            {awayOddsLabel ? ` (${awayOddsLabel})` : ""}
                          </span>
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

                  <details style={{ marginTop: 12 }}>
                    <summary
                      className="ui-summary-plain"
                      style={{
                        cursor: "pointer",
                        fontWeight: 800,
                        fontSize: 12,
                        color: "var(--muted)",
                      }}
                    >
                      Who tipped which team
                    </summary>

                    <div
                      style={{
                        marginTop: 10,
                        display: "grid",
                        gap: 10,
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      }}
                    >
                      {[
                        { label: m.home_team, names: picksForMatch.home },
                        { label: m.away_team, names: picksForMatch.away },
                      ].map((bucket) => (
                        <div
                          key={`${m.id}-${bucket.label}`}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            padding: "8px 10px",
                            background: "var(--card-soft)",
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                            {bucket.label} ({bucket.names.length})
                          </div>
                          {bucket.names.length === 0 ? (
                            <div style={{ fontSize: 12, opacity: 0.7 }}>No one yet</div>
                          ) : (
                            <div style={{ display: "grid", gap: 4 }}>
                              {bucket.names.map((name) => (
                                <div key={`${m.id}-${bucket.label}-${name}`} style={{ fontSize: 12 }}>
                                  {name}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                </UiCard>
              );
            })}
          </div>

          {isRoundLocked && (
            <UiCard soft className="ui-mt-4">
              <div className="ui-row-between" style={{ gap: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Everyone’s tips</div>
                <div className="ui-caption">Sorted by potential total</div>
              </div>

              {players.length === 0 ? (
                <div className="ui-caption ui-mt-3">No tips found for this round.</div>
              ) : (
                <>
                  <div className="ui-row-wrap ui-mt-3" style={{ alignItems: "center", gap: 10 }}>
                    <input
                      value={everyoneTipsSearch}
                      onChange={(e) => setEveryoneTipsSearch(e.target.value)}
                      placeholder="Search member..."
                      className="ui-input"
                    />

                    <button
                      type="button"
                      onClick={jumpToMyTips}
                      disabled={
                        !currentUserId || !everyoneTipsRows.some((p) => p.user_id === currentUserId)
                      }
                      className="ui-btn"
                    >
                      Jump to me
                    </button>

                    <button
                      type="button"
                      onClick={toggleExpandAllVisible}
                      disabled={visibleEveryoneTips.length === 0}
                      className="ui-btn"
                    >
                      {allVisibleExpanded ? "Collapse all" : "Expand all"}
                    </button>
                  </div>

                  {visibleEveryoneTips.length === 0 ? (
                    <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                      No members match your search.
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                      {visibleEveryoneTips.map((p) => {
                        const isExpanded = !!expandedEveryoneTipUserIds[p.user_id];
                        const picksForUser = matches.filter((m) =>
                          Boolean(String(p.picks?.[m.id] ?? "").trim())
                        );

                        return (
                          <div
                            className="ui-card"
                            key={p.user_id}
                            ref={(node) => {
                              everyoneTipsRowRefs.current[p.user_id] = node;
                            }}
                            style={{ padding: 0 }}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedEveryoneTipUserIds((prev) => ({
                                  ...prev,
                                  [p.user_id]: !prev[p.user_id],
                                }))
                              }
                              style={{
                                width: "100%",
                                padding: "10px 12px",
                                border: "none",
                                background: "transparent",
                                color: "inherit",
                                textAlign: "left",
                                cursor: "pointer",
                                display: "grid",
                                gap: 8,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    flexWrap: "wrap",
                                    fontWeight: 900,
                                  }}
                                >
                                  <span style={{ opacity: 0.78, minWidth: 22 }}>#{p.row_rank}</span>
                                  <span
                                    style={{
                                      color:
                                        championHighlightSet.has(p.user_id)
                                          ? "var(--champion-gold)"
                                          : undefined,
                                    }}
                                  >
                                    {p.display_name?.trim() ? p.display_name : "(no display name)"}
                                  </span>
                                  <ChampionSeasonLabels seasons={championSeasonsByUserId[p.user_id]} />
                                  <UnpaidTag paymentStatus={p.payment_status ?? null} />
                                </div>
                                <div style={{ fontSize: 12, opacity: 0.95 }}>
                                  Potential <b>{fmtPts(p.potential_score)}</b>
                                </div>
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  flexWrap: "wrap",
                                  fontSize: 12,
                                  opacity: 0.9,
                                }}
                              >
                                <span>
                                  Underdogs tipped: <b>{p.underdog_count}</b>/<b>{p.picks_count}</b>
                                </span>
                                <span>{isExpanded ? "Hide picks" : "Show picks"}</span>
                              </div>
                            </button>

                            {isExpanded && (
                              <div
                                style={{
                                  borderTop: "1px solid var(--border)",
                                  padding: "8px 12px 10px",
                                  display: "grid",
                                  gap: 6,
                                }}
                              >
                                {picksForUser.length === 0 ? (
                                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                                    No picks available for this member.
                                  </div>
                                ) : (
                                  picksForUser.map((m) => {
                                    const team = String(p.picks?.[m.id] ?? "").trim();
                                    const odds =
                                      team === m.home_team
                                        ? m.home_odds
                                        : team === m.away_team
                                          ? m.away_odds
                                          : null;
                                    const oddsLabel = fmtOdds(odds);

                                    return (
                                      <div
                                        key={`${p.user_id}-${m.id}`}
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          gap: 10,
                                          fontSize: 12,
                                          opacity: 0.95,
                                          borderTop: "1px solid var(--border)",
                                          paddingTop: 6,
                                        }}
                                      >
                                        <div
                                          style={{
                                            opacity: 0.9,
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 6,
                                            flexWrap: "wrap",
                                          }}
                                        >
                                          <span>{matchTitleById[m.id] ?? `${m.home_team} vs ${m.away_team}`}</span>
                                        </div>
                                        <div style={{ fontWeight: 800, textAlign: "right" }}>
                                          {team ? (
                                            <>
                                              {team}
                                              {oddsLabel ? (
                                                <span style={{ opacity: 0.9 }}> ({oddsLabel})</span>
                                              ) : null}
                                            </>
                                          ) : (
                                            <span style={{ opacity: 0.6 }}>—</span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </UiCard>
          )}

          {isRecapAdmin && (
            <UiCard soft className="ui-mt-4">
              <div style={{ fontWeight: 900, fontSize: 16 }}>Admin Round Recap</div>

              {recapLoading && (
                <RoundRecapLoadingSkeleton />
              )}

              {!recapLoading && recapError && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(220, 38, 38, 0.45)",
                    background: "rgba(220, 38, 38, 0.10)",
                    color: "rgb(185, 28, 28)",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {recapError}
                </div>
              )}

              {!recapLoading && !recapError && !roundRecap && (
                <div style={{ marginTop: 8, opacity: 0.75, fontSize: 13 }}>
                  No generated recap found for {getRoundDisplayName(round)}.
                </div>
              )}

              {!recapLoading && !recapError && roundRecap && (
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    Generated {formatMelbourne(roundRecap.generated_at)}
                  </div>

                  <section
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: 12,
                      background: "var(--card)",
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 15 }}>Narrative</div>
                    <pre
                      style={{
                        marginTop: 10,
                        whiteSpace: "pre-wrap",
                        fontFamily: "inherit",
                        lineHeight: 1.5,
                        fontSize: 13,
                      }}
                    >
                      {roundRecap.narrative_text}
                    </pre>
                  </section>

                  <details
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: 12,
                      background: "var(--card)",
                    }}
                  >
                    <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
                      Raw Stats
                    </summary>
                    <pre
                      style={{
                        marginTop: 10,
                        whiteSpace: "pre-wrap",
                        fontFamily: "inherit",
                        lineHeight: 1.45,
                        fontSize: 12,
                      }}
                    >
                      {roundRecap.raw_stats_text}
                    </pre>
                  </details>
                </div>
              )}
            </UiCard>
          )}
        </>
      )}
    </main>
  );
}
