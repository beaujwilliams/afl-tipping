"use client";

import { useEffect, useMemo, useState } from "react";
import {
  UiBadge,
  UiCard,
  UiCardGrid,
  UiTableCell,
  UiTableHeadCell,
  UiTableScroll,
  UiTableShell,
} from "@/components/ui";
import type {
  StatsInsights,
  StatsSnapshot,
  TeamStatsRow,
  TeamStatsTotals,
} from "@/lib/stats-types";

type TeamSortDirection = "asc" | "desc";
type TeamSortKey =
  | "team"
  | "tipped_count"
  | "correct_count"
  | "incorrect_count"
  | "accuracy_pct"
  | "total_points"
  | "avg_points_per_tip"
  | "avg_points_per_correct";

const TEAM_SORT_DEFAULT_DIRECTION: Record<TeamSortKey, TeamSortDirection> = {
  team: "asc",
  tipped_count: "desc",
  correct_count: "desc",
  incorrect_count: "desc",
  accuracy_pct: "desc",
  total_points: "desc",
  avg_points_per_tip: "desc",
  avg_points_per_correct: "desc",
};

function fmtPts(value: number) {
  return Number(value ?? 0).toFixed(2);
}

function fmtPct(value: number) {
  return `${Number(value ?? 0).toFixed(2)}%`;
}

function fmtSigned(value: number) {
  const num = Number(value ?? 0);
  if (num > 0) return `+${num.toFixed(2)}`;
  return num.toFixed(2);
}

function fmtSignedWhole(value: number) {
  const num = Number(value ?? 0);
  if (num > 0) return `+${num}`;
  return `${num}`;
}

function movementLabel(value: number) {
  const num = Number(value ?? 0);
  if (num > 0) return `Up ${num}`;
  if (num < 0) return `Down ${Math.abs(num)}`;
  return "-";
}

export default function StatsPageClient(props: {
  season: number;
  snapshot: StatsSnapshot | null;
  insights: StatsInsights | null;
  teamRows: TeamStatsRow[];
  teamTotals: TeamStatsTotals | null;
  statsMsg: string | null;
  teamStatsMsg: string | null;
}) {
  const [isMobile, setIsMobile] = useState(false);
  const [showAllTeams, setShowAllTeams] = useState(false);
  const [teamSortBy, setTeamSortBy] = useState<TeamSortKey>("total_points");
  const [teamSortDirection, setTeamSortDirection] = useState<TeamSortDirection>("desc");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(max-width: 760px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  const nonZeroTeamRows = useMemo(
    () => props.teamRows.filter((row) => Number(row.tipped_count ?? 0) > 0),
    [props.teamRows]
  );

  const bestTeamByPoints = useMemo(() => {
    if (!nonZeroTeamRows.length) return null;
    return [...nonZeroTeamRows].sort((a, b) => {
      if (b.total_points !== a.total_points) return b.total_points - a.total_points;
      return a.team.localeCompare(b.team, "en", { sensitivity: "base" });
    })[0];
  }, [nonZeroTeamRows]);

  const mostTippedTeam = useMemo(() => {
    if (!nonZeroTeamRows.length) return null;
    return [...nonZeroTeamRows].sort((a, b) => {
      if (b.tipped_count !== a.tipped_count) return b.tipped_count - a.tipped_count;
      return a.team.localeCompare(b.team, "en", { sensitivity: "base" });
    })[0];
  }, [nonZeroTeamRows]);

  const displayedTeamRows = showAllTeams ? props.teamRows : nonZeroTeamRows;
  const sortedDisplayedTeamRows = useMemo(() => {
    const list = [...displayedTeamRows];

    list.sort((a, b) => {
      let primaryCmp = 0;

      if (teamSortBy === "team") {
        primaryCmp = a.team.localeCompare(b.team, "en", { sensitivity: "base" });
      } else {
        primaryCmp = Number(a[teamSortBy] ?? 0) - Number(b[teamSortBy] ?? 0);
      }

      const directionalPrimary = teamSortDirection === "asc" ? primaryCmp : -primaryCmp;
      if (directionalPrimary !== 0) {
        return directionalPrimary;
      }

      if (b.total_points !== a.total_points) {
        return b.total_points - a.total_points;
      }
      return a.team.localeCompare(b.team, "en", { sensitivity: "base" });
    });

    return list;
  }, [displayedTeamRows, teamSortBy, teamSortDirection]);

  const mobileTeamRows = useMemo(
    () => (showAllTeams ? sortedDisplayedTeamRows : sortedDisplayedTeamRows.slice(0, 8)),
    [showAllTeams, sortedDisplayedTeamRows]
  );

  const riskDelta = Number(props.insights?.risk_profile.delta_vs_comp ?? 0);

  function onTeamSort(nextKey: TeamSortKey) {
    if (teamSortBy === nextKey) {
      setTeamSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setTeamSortBy(nextKey);
    setTeamSortDirection(TEAM_SORT_DEFAULT_DIRECTION[nextKey]);
  }

  function teamSortMarker(key: TeamSortKey) {
    if (teamSortBy !== key) return "";
    return teamSortDirection === "asc" ? "Asc" : "Desc";
  }

  return (
    <main className="ui-page ui-page--narrow">
      <div className="ui-page-header">
        <h1 className="ui-title">My Stats</h1>
        <UiBadge>Season {props.season}</UiBadge>
      </div>

      <UiCard soft style={{ marginTop: 16 }}>
        <div className="ui-title--section">Season snapshot</div>
        <div className="ui-caption" style={{ marginTop: 6 }}>
          Where you stand right now and how your decisions are tracking.
        </div>

        {props.statsMsg ? (
          <div className="ui-caption" style={{ marginTop: 12 }}>
            {props.statsMsg}
          </div>
        ) : props.snapshot && props.insights ? (
          <>
            <UiCardGrid columns={4} style={{ marginTop: 12 }}>
              <UiCard>
                <div className="ui-kicker">Rank</div>
                <div className="ui-value">#{props.snapshot.rank}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Total points</div>
                <div className="ui-value">{fmtPts(props.snapshot.total_points)}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Accuracy</div>
                <div className="ui-value">{fmtPct(props.snapshot.accuracy_pct)}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Behind leader</div>
                <div className="ui-value">{fmtPts(props.snapshot.behind_leader)}</div>
              </UiCard>
            </UiCardGrid>

            <UiCardGrid columns={4} style={{ marginTop: 10 }}>
              <UiCard>
                <div className="ui-kicker">Current streak</div>
                <div className="ui-value">{props.insights.current_streak}</div>
                <div className="ui-meta">Longest: {props.insights.longest_streak}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Movement this round</div>
                <div
                  className="ui-value"
                  style={{
                    color:
                      props.snapshot.movement > 0
                        ? "rgb(22,163,74)"
                        : props.snapshot.movement < 0
                          ? "rgb(185,28,28)"
                          : "inherit",
                  }}
                >
                  {fmtSignedWhole(props.snapshot.movement)}
                </div>
                <div className="ui-meta">{movementLabel(props.snapshot.movement)}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Best round</div>
                <div className="ui-value">
                  {props.insights.best_round ? `R${props.insights.best_round.round_number}` : "-"}
                </div>
                <div className="ui-meta">
                  Score: {fmtPts(props.insights.best_round?.score ?? 0)} • Move:{" "}
                  {fmtSignedWhole(props.insights.best_round?.movement ?? 0)}
                </div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Worst round</div>
                <div className="ui-value">
                  {props.insights.worst_round ? `R${props.insights.worst_round.round_number}` : "-"}
                </div>
                <div className="ui-meta">
                  Score: {fmtPts(props.insights.worst_round?.score ?? 0)} • Move:{" "}
                  {fmtSignedWhole(props.insights.worst_round?.movement ?? 0)}
                </div>
              </UiCard>
            </UiCardGrid>
          </>
        ) : null}
      </UiCard>

      {!props.statsMsg && props.snapshot && props.insights && (
        <UiCard soft style={{ marginTop: 14 }}>
          <div className="ui-title--section">Decision insights</div>
          <div className="ui-caption" style={{ marginTop: 6 }}>
            What has helped (or hurt) your season so far.
          </div>

          <UiCardGrid columns={4} style={{ marginTop: 12 }}>
            <UiCard>
              <div className="ui-kicker">Risk profile</div>
              <div
                className="ui-value"
                style={{ color: riskDelta > 0 ? "rgb(22,163,74)" : riskDelta < 0 ? "rgb(185,28,28)" : "inherit" }}
              >
                {fmtSigned(riskDelta)}
              </div>
              <div className="ui-meta">
                Odds avg: {fmtPts(props.insights.risk_profile.avg_tipped_odds)} • Field:{" "}
                {fmtPts(props.insights.risk_profile.comp_avg_tipped_odds)}
              </div>
            </UiCard>

            <UiCard>
              <div className="ui-kicker">Underdog record (2.00+)</div>
              <div className="ui-value">
                {props.insights.underdog_record.correct}/{props.insights.underdog_record.incorrect}
              </div>
              <div className="ui-meta">
                Tips: {props.insights.underdog_record.tips} • Points: {fmtPts(props.insights.underdog_record.points)}
              </div>
            </UiCard>

            <UiCard>
              <div className="ui-kicker">Favourite record (&lt;2.00)</div>
              <div className="ui-value">
                {props.insights.favourite_record.correct}/{props.insights.favourite_record.incorrect}
              </div>
              <div className="ui-meta">
                Tips: {props.insights.favourite_record.tips} • Points: {fmtPts(props.insights.favourite_record.points)}
              </div>
            </UiCard>

            <UiCard>
              <div className="ui-kicker">Avg winning odds</div>
              <div className="ui-value">{fmtPts(props.snapshot.avg_winning_odds)}</div>
              <div className="ui-meta">
                Submitted: {props.snapshot.tips_submitted} • Missed: {props.snapshot.missed_tips}
              </div>
            </UiCard>
          </UiCardGrid>
        </UiCard>
      )}

      <UiCard soft style={{ marginTop: 14 }}>
        <div className="ui-title--section">Team breakdown</div>
        <div className="ui-caption" style={{ marginTop: 6 }}>
          How each team has performed for your tips this season.
        </div>

        {!props.teamStatsMsg && props.teamTotals && (
          <>
            {!isMobile && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowAllTeams((prev) => !prev)}
                  style={{
                    appearance: "none",
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--foreground)",
                    borderRadius: 999,
                    padding: "6px 12px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {showAllTeams ? "Show simplified list" : "Show full team list"}
                </button>
              </div>
            )}

            {isMobile ? (
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {props.teamTotals.correct}/{props.teamTotals.incorrect} correct
                </div>
                <div className="ui-caption" style={{ fontSize: 13 }}>
                  Most tipped: <b>{mostTippedTeam ? mostTippedTeam.team : "-"}</b> • Best scoring:{" "}
                  <b>{bestTeamByPoints ? bestTeamByPoints.team : "-"}</b>
                </div>
              </div>
            ) : (
              <UiCardGrid columns={4} style={{ marginTop: 10 }}>
                <UiCard>
                  <div className="ui-kicker">Total tips</div>
                  <div className="ui-value">{props.teamTotals.tipped}</div>
                </UiCard>
                <UiCard>
                  <div className="ui-kicker">Correct / Incorrect</div>
                  <div className="ui-value">
                    {props.teamTotals.correct} / {props.teamTotals.incorrect}
                  </div>
                </UiCard>
                <UiCard>
                  <div className="ui-kicker">Most tipped</div>
                  <div className="ui-value" style={{ fontSize: 28 }}>
                    {mostTippedTeam ? mostTippedTeam.team : "-"}
                  </div>
                </UiCard>
                <UiCard>
                  <div className="ui-kicker">Best scoring team</div>
                  <div className="ui-value" style={{ fontSize: 28 }}>
                    {bestTeamByPoints ? bestTeamByPoints.team : "-"}
                  </div>
                </UiCard>
              </UiCardGrid>
            )}

            {isMobile ? (
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAllTeams((prev) => !prev)}
                    style={{
                      appearance: "none",
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      color: "var(--foreground)",
                      borderRadius: 999,
                      padding: "6px 12px",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {showAllTeams ? "Show simplified list" : "Show full team list"}
                  </button>
                </div>
                {nonZeroTeamRows.length === 0 ? (
                  <div className="ui-caption">No scored team tips yet.</div>
                ) : (
                  mobileTeamRows.map((row) => (
                    <UiCard key={row.team}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.25 }}>{row.team}</div>
                        <div style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.25 }}>
                          {fmtPts(row.total_points)} pts
                        </div>
                      </div>
                      <div className="ui-caption" style={{ marginTop: 6, fontSize: 13 }}>
                        {row.correct_count}/{row.incorrect_count} • {fmtPct(row.accuracy_pct)} • Avg{" "}
                        {fmtPts(row.avg_points_per_tip)}
                      </div>
                    </UiCard>
                  ))
                )}
              </div>
            ) : (
              <UiTableShell className="ui-mt-3">
                <UiTableScroll>
                  <table className="ui-table ui-table--compact" style={{ minWidth: 920 }}>
                    <thead>
                      <tr className="ui-table-head-row">
                        <UiTableHeadCell style={{ minWidth: 160 }}>
                          <button
                            type="button"
                            onClick={() => onTeamSort("team")}
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              cursor: "pointer",
                              font: "inherit",
                              fontWeight: teamSortBy === "team" ? 800 : 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: 0,
                              whiteSpace: "nowrap",
                            }}
                            title="Sort by team"
                          >
                            <span>Team</span>
                            <span
                              style={{
                                opacity: teamSortBy === "team" ? 1 : 0.45,
                                fontSize: 11,
                                letterSpacing: -0.3,
                              }}
                            >
                              {teamSortMarker("team")}
                            </span>
                          </button>
                        </UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 72 }}>
                          <button
                            type="button"
                            onClick={() => onTeamSort("tipped_count")}
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              cursor: "pointer",
                              font: "inherit",
                              fontWeight: teamSortBy === "tipped_count" ? 800 : 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: 0,
                              whiteSpace: "nowrap",
                            }}
                            title="Sort by tipped count"
                          >
                            <span>Tipped</span>
                            <span
                              style={{
                                opacity: teamSortBy === "tipped_count" ? 1 : 0.45,
                                fontSize: 11,
                                letterSpacing: -0.3,
                              }}
                            >
                              {teamSortMarker("tipped_count")}
                            </span>
                          </button>
                        </UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 84 }}>
                          <button
                            type="button"
                            onClick={() => onTeamSort("correct_count")}
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              cursor: "pointer",
                              font: "inherit",
                              fontWeight: teamSortBy === "correct_count" ? 800 : 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: 0,
                              whiteSpace: "nowrap",
                            }}
                            title="Sort by correct count"
                          >
                            <span>Correct</span>
                            <span
                              style={{
                                opacity: teamSortBy === "correct_count" ? 1 : 0.45,
                                fontSize: 11,
                                letterSpacing: -0.3,
                              }}
                            >
                              {teamSortMarker("correct_count")}
                            </span>
                          </button>
                        </UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 92 }}>
                          <button
                            type="button"
                            onClick={() => onTeamSort("incorrect_count")}
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              cursor: "pointer",
                              font: "inherit",
                              fontWeight: teamSortBy === "incorrect_count" ? 800 : 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: 0,
                              whiteSpace: "nowrap",
                            }}
                            title="Sort by incorrect count"
                          >
                            <span>Incorrect</span>
                            <span
                              style={{
                                opacity: teamSortBy === "incorrect_count" ? 1 : 0.45,
                                fontSize: 11,
                                letterSpacing: -0.3,
                              }}
                            >
                              {teamSortMarker("incorrect_count")}
                            </span>
                          </button>
                        </UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 92 }}>
                          <button
                            type="button"
                            onClick={() => onTeamSort("accuracy_pct")}
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              cursor: "pointer",
                              font: "inherit",
                              fontWeight: teamSortBy === "accuracy_pct" ? 800 : 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: 0,
                              whiteSpace: "nowrap",
                            }}
                            title="Sort by accuracy"
                          >
                            <span>Accuracy</span>
                            <span
                              style={{
                                opacity: teamSortBy === "accuracy_pct" ? 1 : 0.45,
                                fontSize: 11,
                                letterSpacing: -0.3,
                              }}
                            >
                              {teamSortMarker("accuracy_pct")}
                            </span>
                          </button>
                        </UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 92 }}>
                          <button
                            type="button"
                            onClick={() => onTeamSort("total_points")}
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              cursor: "pointer",
                              font: "inherit",
                              fontWeight: teamSortBy === "total_points" ? 800 : 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: 0,
                              whiteSpace: "nowrap",
                            }}
                            title="Sort by points"
                          >
                            <span>Points</span>
                            <span
                              style={{
                                opacity: teamSortBy === "total_points" ? 1 : 0.45,
                                fontSize: 11,
                                letterSpacing: -0.3,
                              }}
                            >
                              {teamSortMarker("total_points")}
                            </span>
                          </button>
                        </UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 108 }}>
                          <button
                            type="button"
                            onClick={() => onTeamSort("avg_points_per_tip")}
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              cursor: "pointer",
                              font: "inherit",
                              fontWeight: teamSortBy === "avg_points_per_tip" ? 800 : 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: 0,
                              whiteSpace: "nowrap",
                            }}
                            title="Sort by avg points per tip"
                          >
                            <span>Avg / Tip</span>
                            <span
                              style={{
                                opacity: teamSortBy === "avg_points_per_tip" ? 1 : 0.45,
                                fontSize: 11,
                                letterSpacing: -0.3,
                              }}
                            >
                              {teamSortMarker("avg_points_per_tip")}
                            </span>
                          </button>
                        </UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 128 }}>
                          <button
                            type="button"
                            onClick={() => onTeamSort("avg_points_per_correct")}
                            style={{
                              appearance: "none",
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              cursor: "pointer",
                              font: "inherit",
                              fontWeight: teamSortBy === "avg_points_per_correct" ? 800 : 600,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: 0,
                              whiteSpace: "nowrap",
                            }}
                            title="Sort by avg points per correct tip"
                          >
                            <span>Avg / Correct</span>
                            <span
                              style={{
                                opacity: teamSortBy === "avg_points_per_correct" ? 1 : 0.45,
                                fontSize: 11,
                                letterSpacing: -0.3,
                              }}
                            >
                              {teamSortMarker("avg_points_per_correct")}
                            </span>
                          </button>
                        </UiTableHeadCell>
                      </tr>
                    </thead>
                    <tbody>
                      {nonZeroTeamRows.length === 0 ? (
                        <tr>
                          <UiTableCell colSpan={8} style={{ color: "var(--muted)" }}>
                            No scored team tips yet.
                          </UiTableCell>
                        </tr>
                      ) : (
                        sortedDisplayedTeamRows.map((row) => (
                          <tr key={row.team}>
                            <UiTableCell style={{ fontWeight: 700 }}>{row.team}</UiTableCell>
                            <UiTableCell>{row.tipped_count}</UiTableCell>
                            <UiTableCell>{row.correct_count}</UiTableCell>
                            <UiTableCell>{row.incorrect_count}</UiTableCell>
                            <UiTableCell>{fmtPct(row.accuracy_pct)}</UiTableCell>
                            <UiTableCell style={{ fontWeight: 700 }}>{fmtPts(row.total_points)}</UiTableCell>
                            <UiTableCell>{fmtPts(row.avg_points_per_tip)}</UiTableCell>
                            <UiTableCell>{fmtPts(row.avg_points_per_correct)}</UiTableCell>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </UiTableScroll>
              </UiTableShell>
            )}
          </>
        )}

        {props.teamStatsMsg && (
          <div className="ui-caption" style={{ marginTop: 12 }}>
            {props.teamStatsMsg}
          </div>
        )}
      </UiCard>
    </main>
  );
}
