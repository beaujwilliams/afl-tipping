"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { UnpaidTag } from "@/components/UnpaidTag";
import { ChampionCrown } from "@/components/ChampionCrown";
import { waitForSession } from "@/lib/session-client";
import {
  UiButtonLink,
  UiCard,
  UiCardGrid,
  UiTableCell,
  UiTableHeadCell,
  UiTableScroll,
  UiTableShell,
} from "@/components/ui";

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
  potential_score: number;
  difference_score: number;
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
type MobileRoundPreset = "core" | "value" | "all";
type MyTipStatus = "correct" | "incorrect" | "pending" | "missed";

type MyTipSummaryRow = {
  match_id: string;
  match_label: string;
  picked: string | null;
  status: MyTipStatus;
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

const ALL_COLUMNS: RoundSortKey[] = [
  "rank",
  "display_name",
  "round_score",
  "correct_tips",
  "accuracy_pct",
  "avg_correct_odds",
  "potential_score",
  "difference_score",
];

const MOBILE_CORE_COLUMNS: RoundSortKey[] = [
  "rank",
  "display_name",
  "round_score",
  "correct_tips",
  "accuracy_pct",
];

const MOBILE_VALUE_COLUMNS: RoundSortKey[] = [
  "rank",
  "display_name",
  "avg_correct_odds",
  "potential_score",
  "difference_score",
];

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

export default function RoundResultsDetailPage() {
  const params = useParams<{ season: string; round: string }>();
  const season = Number(params.season);
  const round = Number(params.round);

  const [msg, setMsg] = useState<string>("Checking session…");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchResultRow[]>([]);
  const [players, setPlayers] = useState<PlayerRoundScore[]>([]);
  const [reigningChampionUserId, setReigningChampionUserId] = useState<string | null>(null);
  const [lockTimeUtc, setLockTimeUtc] = useState<string | null>(null);
  const [isRecapAdmin, setIsRecapAdmin] = useState(false);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState("");
  const [roundRecap, setRoundRecap] = useState<RecapRow | null>(null);
  const [sortBy, setSortBy] = useState<RoundSortKey>("round_score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePreset, setMobilePreset] = useState<MobileRoundPreset>("core");
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
      setCurrentUserId(session.user.id);
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
        setIsRecapAdmin(false);
        setRecapLoading(false);
        setRecapError("");
        setRoundRecap(null);
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

        setRecapLoading(true);
        const recapRes = await fetch(
          `/api/admin/round-recaps?season=${encodeURIComponent(String(season))}&round=${encodeURIComponent(
            String(round)
          )}&limit=1`,
          {
            cache: "no-store",
            headers: { Authorization: `Bearer ${sessionToken}` },
          }
        );

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

        setRecapLoading(false);
        setMsg("");
      } catch {
        setMsg("Could not load round results.");
        setRecapLoading(false);
      }
    })();
  }, [season, round, invalidParams, sessionToken]);

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

  const visibleColumns = useMemo(() => {
    if (!isMobile || mobilePreset === "all") {
      return new Set<RoundSortKey>(ALL_COLUMNS);
    }
    if (mobilePreset === "value") return new Set<RoundSortKey>(MOBILE_VALUE_COLUMNS);
    return new Set<RoundSortKey>(MOBILE_CORE_COLUMNS);
  }, [isMobile, mobilePreset]);

  const fallbackSortBy: RoundSortKey = visibleColumns.has("round_score")
    ? "round_score"
    : visibleColumns.has("potential_score")
      ? "potential_score"
      : "rank";

  const activeSortBy: RoundSortKey = visibleColumns.has(sortBy) ? sortBy : fallbackSortBy;
  const activeSortDirection: SortDirection = visibleColumns.has(sortBy)
    ? sortDirection
    : DEFAULT_SORT_DIR[fallbackSortBy];
  const tableMinWidth = isMobile
    ? mobilePreset === "all"
      ? 980
      : 700
    : 980;

  const finishedMatches = useMemo(() => {
    return matches.filter((m) => !!String(m.winner_team ?? "").trim()).length;
  }, [matches]);

  const tipsPlaced = useMemo(() => {
    return matches.reduce((acc, m) => acc + Number(m.total_tips ?? 0), 0);
  }, [matches]);

  const myRoundRow = useMemo(() => {
    if (!currentUserId) return null;
    return players.find((p) => p.user_id === currentUserId) ?? null;
  }, [players, currentUserId]);

  const myTipRows = useMemo<MyTipSummaryRow[]>(() => {
    return matches.map((m) => {
      const picked = myRoundRow?.picks?.[m.id] ?? null;
      const winner = String(m.winner_team ?? "").trim();
      let status: MyTipStatus = "pending";

      if (winner) {
        if (!picked) status = "missed";
        else status = picked === winner ? "correct" : "incorrect";
      }

      return {
        match_id: m.id,
        match_label: `${m.home_team} vs ${m.away_team}`,
        picked,
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
    if (activeSortBy !== key) return "↕";
    return activeSortDirection === "asc" ? "↑" : "↓";
  }

  function showColumn(key: RoundSortKey) {
    return visibleColumns.has(key);
  }

  return (
    <main className="ui-page ui-page--narrow">
      <div className="ui-row-between-start">
        <div>
          <h1 className="ui-title--section" style={{ margin: 0, fontSize: 30, letterSpacing: -0.4 }}>
            Round {round} Results
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
      {!invalidParams && msg && <div className="ui-caption ui-mt-4">{msg}</div>}

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
              <div className="ui-kicker">Total tips</div>
              <div style={{ marginTop: 5, fontSize: 22, fontWeight: 900 }}>{tipsPlaced}</div>
            </UiCard>
          </UiCardGrid>

          {!!matches.length && (
            <UiCard soft className="ui-mt-3">
              <div className="ui-row-between-start" style={{ gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    Correct so far: {myCorrectSoFar} / {matches.length}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                    Potential score: <b>{fmtPts(myRoundRow?.potential_score ?? 0)}</b>
                  </div>
                </div>

                <div className="ui-badge ui-badge--locked">LOCKED</div>
              </div>

              {isMobile ? (
                <>
                  <div className="ui-row-wrap ui-mt-3" style={{ gap: 8 }}>
                    <span className="ui-badge ui-badge--success" style={{ textTransform: "none" }}>
                      Correct {myCorrectSoFar}/{finishedMatches}
                    </span>
                    <span className="ui-badge ui-badge--info" style={{ textTransform: "none" }}>
                      Still to play {myUpcomingTipRows.length}
                    </span>
                    <span className="ui-badge" style={{ textTransform: "none" }}>
                      Potential {fmtPts(myRoundRow?.potential_score ?? 0)}
                    </span>
                  </div>

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
                              {row.match_label} —{" "}
                              {row.picked ? (
                                <b>{row.picked}</b>
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
                              {row.match_label} —{" "}
                              {row.picked ? (
                                <b>{row.picked}</b>
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
            ) : (
              <UiTableScroll>
                {isMobile && (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--border)",
                      display: "grid",
                      gap: 8,
                      background: "var(--card-soft)",
                    }}
                  >
                    <div className="ui-caption">Stat preset</div>
                    <div className="ui-stat-presets">
                      <button
                        type="button"
                        onClick={() => setMobilePreset("core")}
                        className={`ui-btn ui-btn--pill ${mobilePreset === "core" ? "ui-btn--active-neutral" : ""}`}
                      >
                        Core
                      </button>
                      <button
                        type="button"
                        onClick={() => setMobilePreset("value")}
                        className={`ui-btn ui-btn--pill ${mobilePreset === "value" ? "ui-btn--active-neutral" : ""}`}
                      >
                        Value
                      </button>
                      <button
                        type="button"
                        onClick={() => setMobilePreset("all")}
                        className={`ui-btn ui-btn--pill ${mobilePreset === "all" ? "ui-btn--active-neutral" : ""}`}
                      >
                        All
                      </button>
                    </div>
                  </div>
                )}

                <table className={`ui-table ${isMobile ? "ui-table--compact" : ""}`} style={{ minWidth: tableMinWidth }}>
                  <thead>
                    <tr className="ui-table-head-row">
                      {([
                        ["Rank", "rank"],
                        ["Tipster", "display_name"],
                        [`Round Score (R${round})`, "round_score"],
                        ["Correct", "correct_tips"],
                        ["Round Accuracy", "accuracy_pct"],
                        ["Avg Correct Odds", "avg_correct_odds"],
                        ["Potential Score", "potential_score"],
                        ["Difference", "difference_score"],
                      ] as Array<[string, RoundSortKey]>)
                        .filter(([, key]) => showColumn(key))
                        .map(([label, key]) => (
                          <UiTableHeadCell
                            key={key}
                            style={{
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
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlayers.map((p) => (
                      <tr key={p.user_id}>
                        {showColumn("rank") && (
                          <UiTableCell style={{ fontWeight: 900 }}>
                            #{roundRankByUserId[p.user_id] ?? "-"}
                          </UiTableCell>
                        )}
                        {showColumn("display_name") && (
                          <UiTableCell
                            style={{ fontWeight: 700 }}
                            title={
                              p.payment_status === "pending"
                                ? `${p.display_name} (unpaid)`
                                : p.display_name
                            }
                          >
                            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                              <ChampionCrown isChampion={p.user_id === reigningChampionUserId} />
                              <UnpaidTag paymentStatus={p.payment_status ?? null} compact={isMobile} />
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
                          </UiTableCell>
                        )}
                        {showColumn("round_score") && (
                          <UiTableCell style={{ fontWeight: 800 }}>
                            {fmtPts(p.round_score)}
                          </UiTableCell>
                        )}
                        {showColumn("correct_tips") && (
                          <UiTableCell>
                            {p.correct_tips}
                          </UiTableCell>
                        )}
                        {showColumn("accuracy_pct") && (
                          <UiTableCell>
                            {fmtPct(p.accuracy_pct)}
                          </UiTableCell>
                        )}
                        {showColumn("avg_correct_odds") && (
                          <UiTableCell>
                            {fmtPts(p.avg_correct_odds)}
                          </UiTableCell>
                        )}
                        {showColumn("potential_score") && (
                          <UiTableCell>
                            {fmtPts(p.potential_score)}
                          </UiTableCell>
                        )}
                        {showColumn("difference_score") && (
                          <UiTableCell>
                            {fmtPts(p.difference_score)}
                          </UiTableCell>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </UiTableScroll>
            )}
          </UiTableShell>

          <div className="ui-grid ui-mt-4">
            {matches.map((m) => {
              const winner = String(m.winner_team ?? "").trim();
              const finished = !!winner;

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
                    <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Tipping percentages ({m.total_tips} tips)
                    </div>

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
                </UiCard>
              );
            })}
          </div>

          {isRecapAdmin && (
            <UiCard soft className="ui-mt-4">
              <div style={{ fontWeight: 900, fontSize: 16 }}>Admin Round Recap</div>

              {recapLoading && (
                <div style={{ marginTop: 8, opacity: 0.75, fontSize: 13 }}>
                  Loading recap…
                </div>
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
                  No generated recap found for Round {round}.
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
