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

  const [nowIso, setNowIso] = useState<string>(new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNowIso(new Date().toISOString()), 10000);
    return () => clearInterval(t);
  }, []);

  const isLocked = useMemo(() => {
    if (!roundRow) return false;
    return new Date(nowIso).getTime() >= new Date(roundRow.lock_time_utc).getTime();
  }, [roundRow, nowIso]);

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
          // pick the most recent row per match_id
          const map: Record<string, OddsRow> = {};
          (oddsRows as OddsRow[] | null)?.forEach((row) => {
            if (!map[row.match_id]) map[row.match_id] = row;
          });
          setOddsByMatchId(map);

          const have = Object.keys(map).length;
          setOddsInfo(have ? `Odds available for ${have}/${matchIds.length} matches.` : "No odds captured yet for this round.");
        }
      }
    })();
  }, [season, round]);

  return (
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
      <h1>
        Round {round} • {season}
      </h1>

      {roundRow && (
        <div style={{ marginTop: 10, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <div>
            Lock time (Melbourne): <b>{formatMelbourne(roundRow.lock_time_utc)}</b>
          </div>
          <div style={{ marginTop: 6 }}>
            Status:{" "}
            <b style={{ color: isLocked ? "crimson" : "green" }}>
              {isLocked ? "LOCKED" : "OPEN"}
            </b>
          </div>
          {oddsInfo && <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>{oddsInfo}</div>}
        </div>
      )}

      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}

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
                    fontWeight: picked === g.home_team ? 600 : 500,
                    cursor: isLocked ? "not-allowed" : "pointer",
                    position: "relative",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>{g.home_team}</span>
                    <span style={{ opacity: 0.8 }}>{fmtOdds(homeOdds)}</span>
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
                    fontWeight: picked === g.away_team ? 600 : 500,
                    cursor: isLocked ? "not-allowed" : "pointer",
                    position: "relative",
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>{g.away_team}</span>
                    <span style={{ opacity: 0.8 }}>{fmtOdds(awayOdds)}</span>
                  </div>

                  {picked === g.away_team && (
                    <span style={{ position: "absolute", right: 12, top: 10, fontSize: 16 }}>
                      ✓
                    </span>
                  )}
                </button>
              </div>

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