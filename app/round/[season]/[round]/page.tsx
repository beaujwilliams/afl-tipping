"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type RoundRow = {
  id: string;
  season: number;
  round_number: number;
  lock_time_utc: string;
};

type MatchRow = {
  id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  venue: string | null;
  status: string;
  winner_team: string | null;
};

type TipRow = {
  match_id: string;
  picked_team: string;
};

type OddsRow = {
  match_id: string;
  home_team: string;
  away_team: string;
  home_odds: number;
  away_odds: number;
  captured_at_utc: string;
};

// Starter AFL venue mapping (brand / friendly names)
const VENUE_MAP: Record<string, string> = {
  // NSW
  "Sydney Showground": "ENGIE Stadium",
  "Sydney Showground Stadium": "ENGIE Stadium",
  "S.C.G.": "SCG",
  SCG: "SCG",

  // VIC
  Docklands: "Marvel Stadium",
  "Etihad Stadium": "Marvel Stadium",
  "Marvel Stadium": "Marvel Stadium",
  "M.C.G.": "MCG",
  MCG: "MCG",
  "Kardinia Park": "GMHBA Stadium",
  "G.M.H.B.A. Stadium": "GMHBA Stadium",
  "GMHBA Stadium": "GMHBA Stadium",

  // SA
  "Adelaide Oval": "Adelaide Oval",

  // WA
  "Perth Stadium": "Optus Stadium",
  "Optus Stadium": "Optus Stadium",

  // QLD
  "Brisbane Cricket Ground": "The Gabba",
  Gabba: "The Gabba",
  Carrara: "Heritage Bank Stadium",
  "Metricon Stadium": "Heritage Bank Stadium",
  "Heritage Bank Stadium": "Heritage Bank Stadium",

  // TAS
  "Bellerive Oval": "Blundstone Arena",
  "Blundstone Arena": "Blundstone Arena",
  "York Park": "UTAS Stadium",
  "UTAS Stadium": "UTAS Stadium",

  // NT
  "TIO Stadium": "TIO Stadium",
};

function normalizeVenue(v: string | null) {
  if (!v) return "TBC";
  const key = v.trim();
  return VENUE_MAP[key] ?? key;
}

function formatMelbourne(isoUtc: string) {
  const d = new Date(isoUtc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function msToCountdown(ms: number) {
  if (ms <= 0) return "0m";
  const totalMins = Math.floor(ms / 60000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;

  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function fmtOdds(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  const num = Number(n);
  if (Number.isNaN(num)) return "—";
  return num.toFixed(2);
}

export default function RoundPage() {
  const params = useParams<{ season: string; round: string }>();
  const season = Number(params.season);
  const round = Number(params.round);

  const [roundRow, setRoundRow] = useState<RoundRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [msg, setMsg] = useState<string>("Loading…");

  const [compId, setCompId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [tipsByMatchId, setTipsByMatchId] = useState<Record<string, string>>({});
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);

  // oddsByMatchId[matchId] = { home_odds, away_odds, home_team, away_team }
  const [oddsByMatchId, setOddsByMatchId] = useState<Record<string, OddsRow>>({});
  const [oddsInfo, setOddsInfo] = useState<string>("");

  // Smooth countdown timer
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const lockMs = useMemo(() => {
    if (!roundRow) return null;
    const ms = new Date(roundRow.lock_time_utc).getTime();
    return Number.isNaN(ms) ? null : ms;
  }, [roundRow]);

  const isLocked = useMemo(() => {
    if (!lockMs) return false;
    return nowMs >= lockMs;
  }, [nowMs, lockMs]);

  const lockCountdown = useMemo(() => {
    if (!lockMs) return "";
    return msToCountdown(lockMs - nowMs);
  }, [lockMs, nowMs]);

  const tippedCount = useMemo(() => {
    if (!matches.length) return 0;
    return matches.filter((m) => !!tipsByMatchId[m.id]).length;
  }, [matches, tipsByMatchId]);

  async function saveTip(matchId: string, pickedTeam: string) {
    if (!compId || !userId) return;
    if (isLocked) return;

    setSavingMatchId(matchId);

    const { error } = await supabaseBrowser.from("tips").upsert(
      {
        match_id: matchId,
        competition_id: compId,
        user_id: userId,
        picked_team: pickedTeam,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "match_id,user_id" }
    );

    setSavingMatchId(null);

    if (error) {
      alert(`Could not save tip: ${error.message}`);
      return;
    }

    setTipsByMatchId((prev) => ({ ...prev, [matchId]: pickedTeam }));
  }

  useEffect(() => {
    (async () => {
      setMsg("Loading…");
      setOddsInfo("");

      const { data: auth } = await supabaseBrowser.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }
      setUserId(auth.user.id);

      // single-comp MVP
      const { data: comp, error: cErr } = await supabaseBrowser
        .from("competitions")
        .select("id")
        .limit(1)
        .single();

      if (cErr || !comp) {
        setMsg("No competition found.");
        return;
      }
      setCompId(comp.id);

      const { data: r, error: rErr } = await supabaseBrowser
        .from("rounds")
        .select("id, season, round_number, lock_time_utc")
        .eq("competition_id", comp.id)
        .eq("season", season)
        .eq("round_number", round)
        .single();

      if (rErr || !r) {
        setMsg("Round not found.");
        return;
      }
      setRoundRow(r as RoundRow);

      const { data: m, error: mErr } = await supabaseBrowser
        .from("matches")
        .select("id, commence_time_utc, home_team, away_team, venue, status, winner_team")
        .eq("round_id", r.id)
        .order("commence_time_utc", { ascending: true });

      if (mErr) {
        setMsg(`Error loading matches: ${mErr.message}`);
        return;
      }

      const matchList = (m ?? []) as MatchRow[];
      setMatches(matchList);
      setMsg("");

      const matchIds = matchList.map((x) => x.id);

      // Load tips
      if (matchIds.length) {
        const { data: tips, error: tErr } = await supabaseBrowser
          .from("tips")
          .select("match_id, picked_team")
          .eq("competition_id", comp.id)
          .eq("user_id", auth.user.id)
          .in("match_id", matchIds);

        if (!tErr) {
          const map: Record<string, string> = {};
          (tips as TipRow[] | null)?.forEach((t) => {
            map[t.match_id] = t.picked_team;
          });
          setTipsByMatchId(map);
        }
      }

      // Load odds (latest per match)
      if (matchIds.length) {
        const { data: oddsRows, error: oErr } = await supabaseBrowser
          .from("match_odds")
          .select("match_id, home_team, away_team, home_odds, away_odds, captured_at_utc")
          .eq("competition_id", comp.id)
          .in("match_id", matchIds)
          .order("captured_at_utc", { ascending: false });

        if (oErr) {
          setOddsInfo(`Odds not loaded: ${oErr.message}`);
        } else {
          const map: Record<string, OddsRow> = {};
          (oddsRows as OddsRow[] | null)?.forEach((row) => {
            if (!map[row.match_id]) map[row.match_id] = row;
          });
          setOddsByMatchId(map);

          const have = Object.keys(map).length;
          setOddsInfo(
            have
              ? `Odds available for ${have}/${matchIds.length} matches.`
              : "No odds captured yet for this round."
          );
        }
      }
    })();
  }, [season, round]);

  return (
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
      <h1>
        Round {round} • {season}
      </h1>

      {/* Lock banner + countdown */}
      {roundRow && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.12)",
            background: isLocked ? "rgba(220, 38, 38, 0.06)" : "rgba(34, 197, 94, 0.06)",
          }}
        >
          {isLocked ? (
            <>
              <div style={{ fontWeight: 700 }}>Round locked ✅</div>
              <div style={{ marginTop: 4, opacity: 0.85 }}>
                Locked at <b>{formatMelbourne(roundRow.lock_time_utc)}</b> (Melbourne time)
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "crimson" }}>
                Tips can’t be changed once the round is locked.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700 }}>
                Round locks in <span>{lockCountdown}</span>
              </div>
              <div style={{ marginTop: 4, opacity: 0.85 }}>
                Lock time: <b>{formatMelbourne(roundRow.lock_time_utc)}</b> (Melbourne time)
              </div>
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                Your whole round locks at the first match start time.
              </div>
            </>
          )}

          {oddsInfo && (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
              {oddsInfo}
            </div>
          )}
        </div>
      )}

      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}

      {/* Tips summary */}
      {!!matches.length && (
        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.10)",
            background: "rgba(0,0,0,0.02)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700 }}>
                Your tips: {tippedCount} / {matches.length}
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                Tip all matches before the lock time.
              </div>
            </div>

            {isLocked ? (
              <div style={{ fontWeight: 700, color: "crimson" }}>LOCKED</div>
            ) : (
              <div style={{ fontWeight: 700, color: "green" }}>OPEN</div>
            )}
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            {matches.map((m) => {
              const picked = tipsByMatchId[m.id] ?? null;
              return (
                <div key={m.id} style={{ fontSize: 13, opacity: 0.9 }}>
                  {m.home_team} vs {m.away_team} —{" "}
                  {picked ? (
                    <span>
                      tipped <b>{picked}</b>
                    </span>
                  ) : (
                    <span style={{ opacity: 0.6 }}>Not tipped</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Matches list */}
      <div style={{ marginTop: 20 }}>
        {matches.map((g) => {
          const picked = tipsByMatchId[g.id] ?? null;
          const saving = savingMatchId === g.id;

          const odds = oddsByMatchId[g.id];
          const homeOdds = odds ? odds.home_odds : null;
          const awayOdds = odds ? odds.away_odds : null;

          return (
            <div
              key={g.id}
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 16,
                marginBottom: 16,
                opacity: isLocked ? 0.98 : 1,
              }}
            >
              <div style={{ fontSize: 14, opacity: 0.8 }}>
                {formatMelbourne(g.commence_time_utc)} • {normalizeVenue(g.venue)}
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                {/* Home team button */}
                <button
                  disabled={isLocked || saving}
                  onClick={() => saveTip(g.id, g.home_team)}
                  style={{
                    flex: 1,
                    padding: "14px 18px",
                    borderRadius: 12,
                    border: picked === g.home_team ? "2px solid #0070f3" : "1px solid #ccc",
                    background: picked === g.home_team ? "#e6f3ff" : "white",
                    fontWeight: picked === g.home_team ? 700 : 600,
                    cursor: isLocked ? "not-allowed" : "pointer",
                    position: "relative",
                    textAlign: "left",
                    opacity: isLocked || saving ? 0.65 : 1,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>{g.home_team}</span>
                    <span style={{ opacity: 0.85 }}>{fmtOdds(homeOdds)}</span>
                  </div>

                  {picked === g.home_team && (
                    <span style={{ position: "absolute", right: 12, top: 10, fontSize: 16 }}>
                      ✓
                    </span>
                  )}
                </button>

                {/* Away team button */}
                <button
                  disabled={isLocked || saving}
                  onClick={() => saveTip(g.id, g.away_team)}
                  style={{
                    flex: 1,
                    padding: "14px 18px",
                    borderRadius: 12,
                    border: picked === g.away_team ? "2px solid #0070f3" : "1px solid #ccc",
                    background: picked === g.away_team ? "#e6f3ff" : "white",
                    fontWeight: picked === g.away_team ? 700 : 600,
                    cursor: isLocked ? "not-allowed" : "pointer",
                    position: "relative",
                    textAlign: "left",
                    opacity: isLocked || saving ? 0.65 : 1,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>{g.away_team}</span>
                    <span style={{ opacity: 0.85 }}>{fmtOdds(awayOdds)}</span>
                  </div>

                  {picked === g.away_team && (
                    <span style={{ position: "absolute", right: 12, top: 10, fontSize: 16 }}>
                      ✓
                    </span>
                  )}
                </button>
              </div>

              {saving && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                  Saving…
                </div>
              )}

              {!saving && !isLocked && picked && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                  Saved: <b>{picked}</b>
                </div>
              )}

              {isLocked && (
                <div style={{ marginTop: 8, fontSize: 12, color: "crimson" }}>
                  Round locked — tips cannot be changed.
                </div>
              )}

              {!odds && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                  Odds not captured for this match yet.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}