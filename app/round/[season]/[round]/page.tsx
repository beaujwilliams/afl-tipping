"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type RoundRow = {
  id: string;
  season: number;
  round_number: number;
  lock_time_utc: string;
  odds_snapshot_for_time_utc: string | null;
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
  snapshot_for_time_utc?: string;
};

type TipBreakdownResponse = {
  ok: boolean;
  season: number;
  round: number;
  byMatch: Record<string, Record<string, number>>;
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

  const [oddsByMatchId, setOddsByMatchId] = useState<Record<string, OddsRow>>({});
  const [oddsInfo, setOddsInfo] = useState<string>("");

  // ✅ NEW: tip breakdown once locked
  const [tipBreakdownByMatch, setTipBreakdownByMatch] = useState<Record<string, Record<string, number>>>({});

  // Polling UX
  const [oddsPollingStopped, setOddsPollingStopped] = useState(false);
  const [oddsPollingReason, setOddsPollingReason] = useState<"" | "complete" | "timeout">("");

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

  const oddsHaveCount = useMemo(() => {
    if (!matches.length) return 0;
    return matches.filter((m) => !!oddsByMatchId[m.id]).length;
  }, [matches, oddsByMatchId]);

  const oddsMissing = useMemo(() => {
    if (!matches.length) return false;
    return oddsHaveCount < matches.length;
  }, [matches.length, oddsHaveCount]);

  // ✅ Snapshot window: start polling only within 36 hours of lock time
  const snapshotDueMs = useMemo(() => {
    if (!lockMs) return null;
    return lockMs - 36 * 60 * 60 * 1000; // 36h before lock
  }, [lockMs]);

  const isWithinSnapshotWindow = useMemo(() => {
    if (!snapshotDueMs) return false;
    return nowMs >= snapshotDueMs;
  }, [nowMs, snapshotDueMs]);

  const snapshotForTimeUtc = roundRow?.odds_snapshot_for_time_utc ?? null;

  const shouldPollOdds = useMemo(() => {
    // Only poll when it matters:
    // - round not locked
    // - odds missing
    // - AND (snapshot exists OR within 36h window)
    // - AND we haven't stopped due to complete/timeout
    return (
      !!compId &&
      !!matches.length &&
      !isLocked &&
      oddsMissing &&
      (isWithinSnapshotWindow || !!snapshotForTimeUtc) &&
      !oddsPollingStopped
    );
  }, [compId, matches.length, isLocked, oddsMissing, isWithinSnapshotWindow, snapshotForTimeUtc, oddsPollingStopped]);

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

  function snapshotLabel(snapshot: string | null) {
    return snapshot ? `Snapshot locked: ${formatMelbourne(snapshot)} (Melbourne)` : "Snapshot not set yet (showing latest)";
  }

  // -------- odds loader (LOCKED to round snapshot when present) --------
  async function loadOddsForMatchesLocked(
    competitionId: string,
    matchIds: string[],
    totalMatches: number,
    snapshot: string | null
  ) {
    if (!matchIds.length) return;

    let q = supabaseBrowser
      .from("match_odds")
      .select("match_id, home_team, away_team, home_odds, away_odds, captured_at_utc, snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .in("match_id", matchIds);

    if (snapshot) {
      // ✅ Strict: ONLY show odds from the locked snapshot
      q = q.eq("snapshot_for_time_utc", snapshot);
    } else {
      // Fallback preview: newest snapshot first
      q = q.order("snapshot_for_time_utc", { ascending: false });
    }

    // Always pick most recently captured within whatever scope we’re querying
    q = q.order("captured_at_utc", { ascending: false });

    const { data: oddsRows, error: oErr } = await q;

    if (oErr) {
      setOddsInfo(`Odds not loaded: ${oErr.message}`);
      return;
    }

    const map: Record<string, OddsRow> = {};
    (oddsRows as OddsRow[] | null)?.forEach((row) => {
      if (!map[row.match_id]) map[row.match_id] = row;
    });

    setOddsByMatchId(map);

    const have = Object.keys(map).length;
    setOddsInfo(
      have
        ? `Odds available for ${have}/${totalMatches} matches. • ${snapshotLabel(snapshot)}`
        : `No odds captured yet for this round. • ${snapshotLabel(snapshot)}`
    );

    if (have >= totalMatches && totalMatches > 0) {
      setOddsPollingStopped(true);
      setOddsPollingReason("complete");
    }
  }

  // -------- helper: refresh round snapshot (so UI switches once snapshot runs) --------
  async function refreshRoundSnapshot(competitionId: string, roundId: string) {
    const { data, error } = await supabaseBrowser
      .from("rounds")
      .select("odds_snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .eq("id", roundId)
      .single();

    if (error || !data) return null;
    return (data as any).odds_snapshot_for_time_utc ?? null;
  }

  useEffect(() => {
    (async () => {
      setMsg("Loading…");
      setOddsInfo("");
      setOddsByMatchId({});
      setTipsByMatchId({});
      setOddsPollingStopped(false);
      setOddsPollingReason("");
      setTipBreakdownByMatch({}); // ✅ reset

      const { data: auth } = await supabaseBrowser.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }
      setUserId(auth.user.id);

      // single-comp MVP
      const { data: comp, error: cErr } = await supabaseBrowser.from("competitions").select("id").limit(1).single();
      if (cErr || !comp) {
        setMsg("No competition found.");
        return;
      }
      setCompId(comp.id);

      const { data: r, error: rErr } = await supabaseBrowser
        .from("rounds")
        .select("id, season, round_number, lock_time_utc, odds_snapshot_for_time_utc")
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
        .eq("round_id", (r as any).id)
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
          (tips as TipRow[] | null)?.forEach((t) => (map[t.match_id] = t.picked_team));
          setTipsByMatchId(map);
        }
      }

      // Load odds (locked if snapshot exists)
      await loadOddsForMatchesLocked(comp.id, matchIds, matchIds.length, (r as any).odds_snapshot_for_time_utc ?? null);
    })();
  }, [season, round]);

  // ✅ NEW: when round is locked, fetch tip breakdown per match
  useEffect(() => {
    if (!isLocked) return;

    (async () => {
      try {
        const res = await fetch(
          `/api/round-tip-breakdown?season=${encodeURIComponent(String(season))}&round=${encodeURIComponent(String(round))}`,
          { cache: "no-store" }
        );
        const json = (await res.json().catch(() => null)) as TipBreakdownResponse | null;
        if (res.ok && json?.ok && json.byMatch) {
          setTipBreakdownByMatch(json.byMatch);
        }
      } catch {
        // ignore
      }
    })();
  }, [isLocked, season, round]);

  // -------- Poll odds every 90s while missing, up to 60 minutes --------
  const pollStartRef = useRef<number | null>(null);
  const snapshotKey = snapshotForTimeUtc ?? "no-snapshot";

  useEffect(() => {
    if (!shouldPollOdds) {
      pollStartRef.current = null;
      return;
    }

    if (pollStartRef.current === null) pollStartRef.current = Date.now();

    const POLL_MS = 90_000;
    const MAX_MS = 60 * 60 * 1000;

    const matchIds = matches.map((m) => m.id);
    const roundId = roundRow?.id ?? null;

    const interval = setInterval(async () => {
      const started = pollStartRef.current ?? Date.now();
      const elapsed = Date.now() - started;

      if (elapsed >= MAX_MS) {
        setOddsPollingStopped(true);
        setOddsPollingReason("timeout");
        return;
      }

      // Small jitter so multiple users don’t slam at the same millisecond
      const jitter = Math.floor(Math.random() * 20_000) - 10_000;
      if (jitter > 0) await new Promise((r) => setTimeout(r, jitter));

      // ✅ If snapshot was not set yet, check if it has now been set (after cron/admin snapshot)
      let snap = snapshotForTimeUtc;
      if (!snap && compId && roundId) {
        const fresh = await refreshRoundSnapshot(compId, roundId);
        if (fresh && fresh !== snap) {
          snap = fresh;
          setRoundRow((prev) => (prev ? { ...prev, odds_snapshot_for_time_utc: fresh } : prev));
        }
      }

      await loadOddsForMatchesLocked(compId!, matchIds, matchIds.length, snap);
    }, POLL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPollOdds, compId, matches, snapshotKey, roundRow?.id]);

  useEffect(() => {
    if (!oddsMissing) pollStartRef.current = null;
  }, [oddsMissing, season, round]);

  const showRefreshHint = oddsPollingStopped && oddsPollingReason === "timeout" && oddsMissing;
  const showSnapshotMissedAlert = isLocked && !!matches.length && oddsMissing;

  return (
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
      <h1>
        Round {round} • {season}
      </h1>

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
              <div style={{ marginTop: 6, fontSize: 12, color: "crimson" }}>Tips can’t be changed once the round is locked.</div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700 }}>
                Round locks in <span>{lockCountdown}</span>
              </div>
              <div style={{ marginTop: 4, opacity: 0.85 }}>
                Lock time: <b>{formatMelbourne(roundRow.lock_time_utc)}</b> (Melbourne time)
              </div>
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Your whole round locks at the first match start time.</div>
            </>
          )}

          {oddsInfo && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>{oddsInfo}</div>}
        </div>
      )}

      {showSnapshotMissedAlert && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(220, 38, 38, 0.35)",
            background: "rgba(220, 38, 38, 0.08)",
          }}
        >
          <div style={{ fontWeight: 900, color: "crimson" }}>⚠️ Odds snapshot hasn’t run for this round.</div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
            This round is locked, but we’re still missing odds for <b>{matches.length - oddsHaveCount}</b> match(es). Admin: run{" "}
            <b>Snapshot Next Due Round</b> (or force snapshot) to backfill.
          </div>
        </div>
      )}

      {!!matches.length && oddsMissing && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.10)",
            background: "rgba(245, 158, 11, 0.10)",
          }}
        >
          <div style={{ fontWeight: 800 }}>Odds will be locked at the snapshot time. Your pick is saved.</div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
            Odds captured for <b>{oddsHaveCount}</b>/<b>{matches.length}</b> matches so far.
            {shouldPollOdds && <span style={{ marginLeft: 8, opacity: 0.85 }}>(Auto-checking every 90s)</span>}
            {!shouldPollOdds && !isLocked && snapshotDueMs && nowMs < snapshotDueMs && (
              <span style={{ marginLeft: 8, opacity: 0.85 }}>(We’ll start checking within 36h of lock)</span>
            )}
          </div>
        </div>
      )}

      {showRefreshHint && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.10)",
            background: "rgba(59, 130, 246, 0.10)",
          }}
        >
          <div style={{ fontWeight: 800 }}>Still waiting on odds.</div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>We’ll stop auto-checking to save requests. Refresh this page to check again.</div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.18)",
              background: "white",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Refresh now
          </button>
        </div>
      )}

      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}

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
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>Tip all matches before the lock time.</div>
            </div>

            {isLocked ? <div style={{ fontWeight: 700, color: "crimson" }}>LOCKED</div> : <div style={{ fontWeight: 700, color: "green" }}>OPEN</div>}
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

      <div style={{ marginTop: 20 }}>
        {matches.map((g) => {
          const picked = tipsByMatchId[g.id] ?? null;
          const saving = savingMatchId === g.id;

          const odds = oddsByMatchId[g.id];
          const homeOdds = odds ? odds.home_odds : null;
          const awayOdds = odds ? odds.away_odds : null;

          // ✅ NEW: tip breakdown counts (only shown when locked)
          const breakdown = tipBreakdownByMatch[g.id] ?? {};
          const homeTips = breakdown[g.home_team] ?? 0;
          const awayTips = breakdown[g.away_team] ?? 0;

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
                <button
                  disabled={isLocked || saving}
                  onClick={() => saveTip(g.id, g.home_team)}
                  style={{
                    flex: 1,
                    padding: "14px 18px",
                    borderRadius: 12,
                    border: picked === g.home_team ? "2px solid #0070f3" : "1px solid #ccc",
                    background: picked === g.home_team ? "#e6f3ff" : "white",
                    color: "#111",
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
                  {picked === g.home_team && <span style={{ position: "absolute", right: 12, top: 10, fontSize: 16 }}>✓</span>}
                </button>

                <button
                  disabled={isLocked || saving}
                  onClick={() => saveTip(g.id, g.away_team)}
                  style={{
                    flex: 1,
                    padding: "14px 18px",
                    borderRadius: 12,
                    border: picked === g.away_team ? "2px solid #0070f3" : "1px solid #ccc",
                    background: picked === g.away_team ? "#e6f3ff" : "white",
                    color: "#111",
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
                  {picked === g.away_team && <span style={{ position: "absolute", right: 12, top: 10, fontSize: 16 }}>✓</span>}
                </button>
              </div>

              {/* ✅ NEW: show tip breakdown once locked */}
              {isLocked && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                  Tip breakdown:{" "}
                  <b>{g.home_team}</b> {homeTips} • <b>{g.away_team}</b> {awayTips}
                </div>
              )}

              {saving && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>Saving…</div>}

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

              {!odds && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>Odds not captured for this match yet.</div>}
            </div>
          );
        })}
      </div>
    </main>
  );
}