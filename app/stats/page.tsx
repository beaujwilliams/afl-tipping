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

type LeaderboardRow = {
  user_id: string;
  rank: number;
  total_points: number;
  accuracy_pct: number;
};

type LeaderboardApiResponse = {
  ok?: boolean;
  error?: string;
  rows?: LeaderboardRow[];
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

export default function StatsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsMsg, setStatsMsg] = useState<string | null>(null);
  const [myRow, setMyRow] = useState<LeaderboardRow | null>(null);
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
          setMyRow(null);
          setTeamRows([]);
          setTeamTotals(null);
          setStatsLoading(false);
          return;
        }

        const [leaderboardRes, teamStatsRes] = await Promise.all([
          fetch(`/api/leaderboard?season=${encodeURIComponent(String(CURRENT_SEASON))}`, {
            cache: "no-store",
          }),
          fetch(`/api/profile-team-stats?season=${encodeURIComponent(String(CURRENT_SEASON))}`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const leaderboardBody = (await leaderboardRes.json().catch(() => null)) as
          | LeaderboardApiResponse
          | null;
        const teamStatsBody = (await teamStatsRes.json().catch(() => null)) as
          | TeamStatsApiResponse
          | null;

        if (!alive) return;

        if (!leaderboardRes.ok || !leaderboardBody?.ok) {
          setStatsMsg(leaderboardBody?.error ?? "Could not load season stats.");
          setMyRow(null);
        } else {
          const row = (leaderboardBody.rows ?? []).find((r) => r.user_id === userId) ?? null;
          setMyRow(row);
          if (!row) {
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
        setMyRow(null);
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

  return (
    <main className="ui-page ui-page--narrow">
      <div className="ui-page-header">
        <h1 className="ui-title">My Stats</h1>
        <UiBadge>Season {CURRENT_SEASON}</UiBadge>
      </div>

      <UiCard soft style={{ marginTop: 16 }}>
        <div className="ui-title--section">Season stats</div>
        <div className="ui-caption" style={{ marginTop: 6 }}>
          Your current standing and performance for {CURRENT_SEASON}.
        </div>

        {statsLoading ? (
          <div className="ui-caption" style={{ marginTop: 12 }}>
            Loading season stats…
          </div>
        ) : statsMsg ? (
          <div className="ui-caption" style={{ marginTop: 12 }}>
            {statsMsg}
          </div>
        ) : myRow ? (
          <UiCardGrid columns={3} style={{ marginTop: 12 }}>
            <UiCard>
              <div className="ui-kicker">Rank</div>
              <div className="ui-value">#{myRow.rank}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Total Points</div>
              <div className="ui-value">{fmtPts(myRow.total_points)}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Accuracy</div>
              <div className="ui-value">{fmtPct(myRow.accuracy_pct)}</div>
            </UiCard>
          </UiCardGrid>
        ) : null}

        {!statsLoading && !teamStatsMsg && teamTotals && (
          <>
            <div className="ui-kicker" style={{ marginTop: 16 }}>
              Team breakdown
            </div>
            <div className="ui-caption" style={{ marginTop: 4 }}>
              How each team has performed for your tips this season.
            </div>
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
                  <div className="ui-kicker">Total Tips</div>
                  <div className="ui-value">{teamTotals.tipped}</div>
                </UiCard>
                <UiCard>
                  <div className="ui-kicker">Correct / Incorrect</div>
                  <div className="ui-value">
                    {teamTotals.correct} / {teamTotals.incorrect}
                  </div>
                </UiCard>
                <UiCard>
                  <div className="ui-kicker">Most Tipped</div>
                  <div className="ui-value" style={{ fontSize: 28 }}>
                    {mostTippedTeam ? mostTippedTeam.team : "-"}
                  </div>
                </UiCard>
                <UiCard>
                  <div className="ui-kicker">Best Scoring Team</div>
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
