"use client";

import { useEffect, useState } from "react";
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

export default function LeaderboardPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [latestScoredRound, setLatestScoredRound] = useState<number | null>(null);
  const [previousRoundForMovement, setPreviousRoundForMovement] = useState<number | null>(null);
  const [matchesScored, setMatchesScored] = useState(0);
  const [msg, setMsg] = useState("Loading...");

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
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Rank</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Tipster</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Total Pts</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Correct</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Accuracy</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Tips</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Missed</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
                        {latestScoredRound === null ? "Round Score" : `Round Score (R${latestScoredRound})`}
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Move</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Behind</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Streak</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Avg Win Odds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.user_id}>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)", fontWeight: 900 }}>
                          #{r.rank}
                        </td>
                        <td style={{ padding: "12px", borderTop: "1px solid var(--border)", fontWeight: 700 }}>
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
