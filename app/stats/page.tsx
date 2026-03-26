"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  UiBadge,
  UiCard,
  UiCardGrid,
  UiTableCell,
  UiTableHeadCell,
  UiTableScroll,
  UiTableShell,
} from "@/components/ui";

const CURRENT_SEASON = 2026;

type StatsSnapshot = {
  rank: number;
  total_points: number;
  accuracy_pct: number;
  behind_leader: number;
  movement: number;
  current_streak: number;
  correct_tips: number;
  tips_submitted: number;
  missed_tips: number;
  round_score: number;
  avg_winning_odds: number;
};

type StatsInsights = {
  current_streak: number;
  longest_streak: number;
  underdog_record: { tips: number; correct: number; incorrect: number; points: number };
  favourite_record: { tips: number; correct: number; incorrect: number; points: number };
  risk_profile: { avg_tipped_odds: number; comp_avg_tipped_odds: number; delta_vs_comp: number };
  contrarian_edge: {
    contrarian_picks: number;
    rounds_with_contrarian_pick: number;
    net_points_delta: number;
    gained_rounds: number;
    lost_rounds: number;
  };
  best_round: { round_number: number; score: number; movement: number } | null;
  worst_round: { round_number: number; score: number; movement: number } | null;
  points_vs_comp_avg: { user_points: number; comp_avg_points: number; delta: number };
  missed_tips_impact: { missed_tips: number; potential_points_lost: number };
};

type MyStatsInsightsResponse = {
  ok?: boolean;
  error?: string;
  snapshot?: StatsSnapshot | null;
  insights?: StatsInsights;
};

type TeamStatsRow = {
  team: string;
  tipped_count: number;
  correct_count: number;
  incorrect_count: number;
  accuracy_pct: number;
  total_points: number;
  avg_points_per_tip: number;
  avg_points_per_correct: number;
};

type TeamStatsApiResponse = {
  ok?: boolean;
  error?: string;
  rows?: TeamStatsRow[];
  totals?: {
    tipped: number;
    correct: number;
    incorrect: number;
    total_points: number;
  };
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
  return "No change";
}

export default function StatsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsMsg, setStatsMsg] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<StatsSnapshot | null>(null);
  const [insights, setInsights] = useState<StatsInsights | null>(null);

  const [teamStatsMsg, setTeamStatsMsg] = useState<string | null>(null);
  const [teamRows, setTeamRows] = useState<TeamStatsRow[]>([]);
  const [teamTotals, setTeamTotals] = useState<{
    tipped: number;
    correct: number;
    incorrect: number;
    total_points: number;
  } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showAllTeams, setShowAllTeams] = useState(false);

  async function getAccessToken() {
    const { data } = await supabaseBrowser.auth.getSession();
    return data.session?.access_token ?? null;
  }

  useEffect(() => {
    let mounted = true;

    async function ensureAuth() {
      const { data: authData } = await supabaseBrowser.auth.getUser();
      const user = authData.user;
      if (!user) {
        window.location.href = "/login";
        return;
      }
      if (!mounted) return;
      setUserId(user.id);
    }

    ensureAuth();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let alive = true;

    async function loadStats() {
      setStatsLoading(true);
      setStatsMsg(null);
      setTeamStatsMsg(null);

      try {
        const token = await getAccessToken();
        if (!token) {
          setStatsMsg("Not authenticated.");
          setSnapshot(null);
          setInsights(null);
          setTeamRows([]);
          setTeamTotals(null);
          setStatsLoading(false);
          return;
        }

        const [insightsRes, teamStatsRes] = await Promise.all([
          fetch(`/api/my-stats-insights?season=${encodeURIComponent(String(CURRENT_SEASON))}`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`/api/profile-team-stats?season=${encodeURIComponent(String(CURRENT_SEASON))}`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const insightsBody = (await insightsRes.json().catch(() => null)) as
          | MyStatsInsightsResponse
          | null;
        const teamStatsBody = (await teamStatsRes.json().catch(() => null)) as
          | TeamStatsApiResponse
          | null;

        if (!alive) return;

        if (!insightsRes.ok || !insightsBody?.ok || !insightsBody?.insights) {
          setStatsMsg(insightsBody?.error ?? "Could not load season stats.");
          setSnapshot(null);
          setInsights(null);
        } else {
          setSnapshot((insightsBody.snapshot as StatsSnapshot | null) ?? null);
          setInsights(insightsBody.insights);
          if (!insightsBody.snapshot) {
            setStatsMsg("No season stats yet.");
          }
        }

        if (!teamStatsRes.ok || !teamStatsBody?.ok) {
          setTeamStatsMsg(teamStatsBody?.error ?? "Could not load team breakdown.");
          setTeamRows([]);
          setTeamTotals(null);
        } else {
          const nextRows = Array.isArray(teamStatsBody.rows) ? teamStatsBody.rows : [];
          const nextTotals = teamStatsBody.totals ?? null;
          setTeamRows(nextRows);
          setTeamTotals(nextTotals);
          if (!nextRows.length) {
            setTeamStatsMsg("No team stats yet.");
          }
        }
      } catch {
        if (!alive) return;
        setStatsMsg("Could not load season stats.");
        setTeamStatsMsg("Could not load team breakdown.");
        setSnapshot(null);
        setInsights(null);
        setTeamRows([]);
        setTeamTotals(null);
      } finally {
        if (!alive) return;
        setStatsLoading(false);
      }
    }

    loadStats();
    return () => {
      alive = false;
    };
  }, [userId]);

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
    () => teamRows.filter((row) => Number(row.tipped_count ?? 0) > 0),
    [teamRows]
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

  const displayedTeamRows = showAllTeams ? teamRows : nonZeroTeamRows;
  const mobileTeamRows = useMemo(
    () => (showAllTeams ? displayedTeamRows : displayedTeamRows.slice(0, 8)),
    [showAllTeams, displayedTeamRows]
  );

  const pointsVsAvgDelta = Number(insights?.points_vs_comp_avg.delta ?? 0);
  const riskDelta = Number(insights?.risk_profile.delta_vs_comp ?? 0);

  return (
    <main className="ui-page ui-page--narrow">
      <div className="ui-page-header">
        <h1 className="ui-title">My Stats</h1>
        <UiBadge>Season {CURRENT_SEASON}</UiBadge>
      </div>

      <UiCard soft style={{ marginTop: 16 }}>
        <div className="ui-title--section">Season snapshot</div>
        <div className="ui-caption" style={{ marginTop: 6 }}>
          Where you stand right now and how your decisions are tracking.
        </div>

        {statsLoading ? (
          <div className="ui-caption" style={{ marginTop: 12 }}>
            Loading season stats…
          </div>
        ) : statsMsg ? (
          <div className="ui-caption" style={{ marginTop: 12 }}>
            {statsMsg}
          </div>
        ) : snapshot && insights ? (
          <>
            <UiCardGrid columns={4} style={{ marginTop: 12 }}>
              <UiCard>
                <div className="ui-kicker">Rank</div>
                <div className="ui-value">#{snapshot.rank}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Total points</div>
                <div className="ui-value">{fmtPts(snapshot.total_points)}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Accuracy</div>
                <div className="ui-value">{fmtPct(snapshot.accuracy_pct)}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Behind leader</div>
                <div className="ui-value">{fmtPts(snapshot.behind_leader)}</div>
              </UiCard>
            </UiCardGrid>

            <UiCardGrid columns={4} style={{ marginTop: 10 }}>
              <UiCard>
                <div className="ui-kicker">Current streak</div>
                <div className="ui-value">{insights.current_streak}</div>
                <div className="ui-meta">Longest: {insights.longest_streak}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Points vs comp avg</div>
                <div
                  className="ui-value"
                  style={{ color: pointsVsAvgDelta < 0 ? "rgb(185,28,28)" : "inherit" }}
                >
                  {fmtSigned(pointsVsAvgDelta)}
                </div>
                <div className="ui-meta">
                  You: {fmtPts(insights.points_vs_comp_avg.user_points)} • Avg:{" "}
                  {fmtPts(insights.points_vs_comp_avg.comp_avg_points)}
                </div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Risk profile</div>
                <div
                  className="ui-value"
                  style={{ color: riskDelta > 0 ? "rgb(22,163,74)" : riskDelta < 0 ? "rgb(185,28,28)" : "inherit" }}
                >
                  {fmtSigned(riskDelta)}
                </div>
                <div className="ui-meta">
                  Odds avg: {fmtPts(insights.risk_profile.avg_tipped_odds)} • Field:{" "}
                  {fmtPts(insights.risk_profile.comp_avg_tipped_odds)}
                </div>
              </UiCard>
            </UiCardGrid>
          </>
        ) : null}
      </UiCard>

      {!statsLoading && !statsMsg && snapshot && insights && (
        <UiCard soft style={{ marginTop: 14 }}>
          <div className="ui-title--section">Decision insights</div>
          <div className="ui-caption" style={{ marginTop: 6 }}>
            What has helped (or hurt) your season so far.
          </div>

          <UiCardGrid columns={4} style={{ marginTop: 12 }}>
            <UiCard>
              <div className="ui-kicker">Underdog record (2.00+)</div>
              <div className="ui-value">
                {insights.underdog_record.correct}/{insights.underdog_record.incorrect}
              </div>
              <div className="ui-meta">
                Tips: {insights.underdog_record.tips} • Points: {fmtPts(insights.underdog_record.points)}
              </div>
            </UiCard>

            <UiCard>
              <div className="ui-kicker">Favourite record (&lt;2.00)</div>
              <div className="ui-value">
                {insights.favourite_record.correct}/{insights.favourite_record.incorrect}
              </div>
              <div className="ui-meta">
                Tips: {insights.favourite_record.tips} • Points: {fmtPts(insights.favourite_record.points)}
              </div>
            </UiCard>

            <UiCard>
              <div className="ui-kicker">Movement this round</div>
              <div
                className="ui-value"
                style={{
                  color:
                    snapshot.movement > 0
                      ? "rgb(22,163,74)"
                      : snapshot.movement < 0
                      ? "rgb(185,28,28)"
                      : "inherit",
                }}
              >
                {fmtSignedWhole(snapshot.movement)}
              </div>
              <div className="ui-meta">{movementLabel(snapshot.movement)}</div>
            </UiCard>

            <UiCard>
              <div className="ui-kicker">Best round</div>
              <div className="ui-value">
                {insights.best_round ? `R${insights.best_round.round_number}` : "-"}
              </div>
              <div className="ui-meta">
                Score: {fmtPts(insights.best_round?.score ?? 0)} • Move:{" "}
                {fmtSignedWhole(insights.best_round?.movement ?? 0)}
              </div>
            </UiCard>

            <UiCard>
              <div className="ui-kicker">Worst round</div>
              <div className="ui-value">
                {insights.worst_round ? `R${insights.worst_round.round_number}` : "-"}
              </div>
              <div className="ui-meta">
                Score: {fmtPts(insights.worst_round?.score ?? 0)} • Move:{" "}
                {fmtSignedWhole(insights.worst_round?.movement ?? 0)}
              </div>
            </UiCard>

            <UiCard>
              <div className="ui-kicker">Avg winning odds</div>
              <div className="ui-value">{fmtPts(snapshot.avg_winning_odds)}</div>
              <div className="ui-meta">
                Submitted: {snapshot.tips_submitted} • Missed: {snapshot.missed_tips}
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

        {!statsLoading && !teamStatsMsg && teamTotals && (
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
                  {teamTotals.correct}/{teamTotals.incorrect} correct
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
                  <div className="ui-value">{teamTotals.tipped}</div>
                </UiCard>
                <UiCard>
                  <div className="ui-kicker">Correct / Incorrect</div>
                  <div className="ui-value">
                    {teamTotals.correct} / {teamTotals.incorrect}
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
                        <UiTableHeadCell style={{ minWidth: 160 }}>Team</UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 72 }}>Tipped</UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 84 }}>Correct</UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 92 }}>Incorrect</UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 92 }}>Accuracy</UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 92 }}>Points</UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 108 }}>Avg / Tip</UiTableHeadCell>
                        <UiTableHeadCell style={{ minWidth: 128 }}>Avg / Correct</UiTableHeadCell>
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
                        displayedTeamRows.map((row) => (
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

        {!statsLoading && teamStatsMsg && (
          <div className="ui-caption" style={{ marginTop: 12 }}>
            {teamStatsMsg}
          </div>
        )}
      </UiCard>
    </main>
  );
}
