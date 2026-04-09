"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import {
  type RoundPageInitialData,
  type RoundPageMatchRow as MatchRow,
  type RoundPageOddsRow as OddsRow,
  type RoundPagePaymentStatus as PaymentStatus,
  type RoundPageRoundRow as RoundRow,
} from "@/lib/round-page-data";
import {
  buildRoundPageOddsMap,
  normalizeRoundPagePaymentStatus,
} from "@/lib/round-page-rules";
import { getRoundDisplayName } from "@/lib/round-label";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiSkeleton } from "@/components/ui";

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

function tipOptionButtonStyle(isSelected: boolean, isDisabled: boolean) {
  return {
    flex: 1,
    padding: "14px 18px",
    borderRadius: 12,
    border: isSelected ? "2px solid #16a34a" : "1px solid #cfcfcf",
    background: isSelected ? "#eafcf1" : "#ffffff",
    color: "#111",
    fontWeight: isSelected ? 800 : 600,
    cursor: isDisabled ? "not-allowed" : "pointer",
    textAlign: "left" as const,
    opacity: isDisabled ? 0.65 : 1,
    boxShadow: isSelected ? "0 0 0 3px rgba(34, 197, 94, 0.40), 0 8px 18px rgba(22, 163, 74, 0.18)" : "none",
    transform: isSelected ? "translateY(-1px)" : "none",
    transition: "box-shadow 140ms ease, border-color 140ms ease, background-color 140ms ease, transform 140ms ease",
  };
}

function RoundLoadingSkeleton() {
  return (
    <div className="ui-grid ui-mt-3" style={{ gap: 18 }}>
      <div className="ui-card-grid ui-card-grid--3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={`round-card-skeleton-${index}`} className="ui-card ui-card-soft">
            <UiSkeleton width="34%" height={12} />
            <UiSkeleton width="72%" height={30} className="ui-mt-2" />
            <UiSkeleton width="46%" height={12} className="ui-mt-2" />
          </div>
        ))}
      </div>

      <div className="ui-card ui-card-soft">
        <div className="ui-row-between-start">
          <div className="ui-grid" style={{ gap: 8, minWidth: 220, flex: 1 }}>
            <UiSkeleton width="34%" height={18} />
            <UiSkeleton width="44%" height={12} />
          </div>
          <UiSkeleton width={74} height={28} radius={999} />
        </div>

        <div className="ui-grid ui-mt-3" style={{ gap: 12 }}>
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={`round-match-skeleton-${index}`}
              style={{
                borderTop: index === 0 ? "none" : "1px solid var(--border)",
                paddingTop: index === 0 ? 0 : 12,
                display: "grid",
                gap: 10,
              }}
            >
              <UiSkeleton width="38%" height={12} />
              <div style={{ display: "grid", gap: 10 }}>
                <UiSkeleton width="100%" height={70} radius={16} />
                <UiSkeleton width="100%" height={70} radius={16} />
              </div>
              <UiSkeleton width="26%" height={12} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type RoundPageClientProps = {
  season: number;
  round: number;
  initialData: RoundPageInitialData | null;
  initialMessage?: string | null;
};

export default function RoundPageClient({
  season,
  round,
  initialData,
  initialMessage,
}: RoundPageClientProps) {
  const toast = useToast();

  const [roundRow, setRoundRow] = useState<RoundRow | null>(initialData?.round_row ?? null);
  const [matches, setMatches] = useState<MatchRow[]>(initialData?.matches ?? []);
  const [msg, setMsg] = useState<string>(initialMessage ?? "");

  const [tipsByMatchId, setTipsByMatchId] = useState<Record<string, string>>(
    initialData?.tips_by_match_id ?? {}
  );
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    initialData?.payment_status ?? "pending"
  );
  const [paymentLocked, setPaymentLocked] = useState(initialData?.payment_locked ?? false);
  const [enforceUnpaidTipLock, setEnforceUnpaidTipLock] = useState(
    initialData?.enforce_unpaid_tip_lock ?? false
  );

  const [oddsByMatchId, setOddsByMatchId] = useState<Record<string, OddsRow>>(
    initialData?.odds_by_match_id ?? {}
  );
  const [oddsInfo, setOddsInfo] = useState<string>(initialData?.odds_info ?? "");

  // Polling UX
  const [oddsPollingStopped, setOddsPollingStopped] = useState(() => {
    if (!initialData) return false;
    const oddsCount = Object.keys(initialData.odds_by_match_id ?? {}).length;
    const totalMatches = initialData.matches?.length ?? 0;
    return totalMatches > 0 && oddsCount >= totalMatches;
  });
  const [oddsPollingReason, setOddsPollingReason] = useState<
    "" | "complete" | "timeout"
  >(() => {
    if (!initialData) return "";
    const oddsCount = Object.keys(initialData.odds_by_match_id ?? {}).length;
    const totalMatches = initialData.matches?.length ?? 0;
    return totalMatches > 0 && oddsCount >= totalMatches ? "complete" : "";
  });
  const pollStartRef = useRef<number | null>(null);

  const userId = initialData?.user_id ?? null;
  const compId = roundRow?.competition_id ?? initialData?.competition_id ?? null;

  useEffect(() => {
    setRoundRow(initialData?.round_row ?? null);
    setMatches(initialData?.matches ?? []);
    setMsg(initialMessage ?? "");
    setTipsByMatchId(initialData?.tips_by_match_id ?? {});
    setSavingMatchId(null);
    setPaymentStatus(initialData?.payment_status ?? "pending");
    setPaymentLocked(initialData?.payment_locked ?? false);
    setEnforceUnpaidTipLock(initialData?.enforce_unpaid_tip_lock ?? false);
    setOddsByMatchId(initialData?.odds_by_match_id ?? {});
    setOddsInfo(initialData?.odds_info ?? "");

    const oddsCount = Object.keys(initialData?.odds_by_match_id ?? {}).length;
    const totalMatches = initialData?.matches?.length ?? 0;
    const complete = totalMatches > 0 && oddsCount >= totalMatches;
    setOddsPollingStopped(complete);
    setOddsPollingReason(complete ? "complete" : "");
    pollStartRef.current = null;
  }, [initialData, initialMessage, round, season]);

  // Smooth countdown timer
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
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

  const potentialScore = useMemo(() => {
    if (!matches.length) return 0;
    let total = 0;

    for (const m of matches) {
      const picked = tipsByMatchId[m.id];
      if (!picked) continue;

      const odds = oddsByMatchId[m.id];
      if (!odds) continue;

      let pickedOdds = 0;
      if (picked === m.home_team) pickedOdds = Number(odds.home_odds ?? 0);
      else if (picked === m.away_team) pickedOdds = Number(odds.away_odds ?? 0);

      if (Number.isFinite(pickedOdds) && pickedOdds > 0) {
        total += pickedOdds;
      }
    }

    return total;
  }, [matches, tipsByMatchId, oddsByMatchId]);

  const oddsHaveCount = useMemo(() => {
    if (!matches.length) return 0;
    return matches.filter((m) => !!oddsByMatchId[m.id]).length;
  }, [matches, oddsByMatchId]);

  const oddsMissing = useMemo(() => {
    if (!matches.length) return false;
    return oddsHaveCount < matches.length;
  }, [matches.length, oddsHaveCount]);

  const oddsLoadedForRound = useMemo(() => {
    return matches.length > 0 && oddsHaveCount >= matches.length;
  }, [matches.length, oddsHaveCount]);

  const oddsLoadedAtIso = useMemo(() => {
    const captured = Object.values(oddsByMatchId)
      .map((row) => new Date(row.captured_at_utc).getTime())
      .filter((ms) => Number.isFinite(ms));

    if (!captured.length) return null;
    return new Date(Math.max(...captured)).toISOString();
  }, [oddsByMatchId]);

  // Start polling only within 36 hours of lock time.
  const snapshotDueMs = useMemo(() => {
    if (!lockMs) return null;
    return lockMs - 36 * 60 * 60 * 1000; // 36h before lock
  }, [lockMs]);

  const isWithinSnapshotWindow = useMemo(() => {
    if (!snapshotDueMs) return false;
    return nowMs >= snapshotDueMs;
  }, [nowMs, snapshotDueMs]);

  const snapshotForTimeUtc = roundRow?.odds_snapshot_for_time_utc ?? null;
  const scoringOddsLocked = !!snapshotForTimeUtc;
  const showLoadedOddsState = scoringOddsLocked && oddsLoadedForRound;
  const oddsExpectedFromIso = snapshotDueMs ? new Date(snapshotDueMs).toISOString() : null;
  const oddsExpectedCountdown =
    snapshotDueMs && nowMs < snapshotDueMs ? msToCountdown(snapshotDueMs - nowMs) : null;

  const shouldPollOdds = useMemo(() => {
    return (
      !!compId &&
      !!matches.length &&
      !isLocked &&
      oddsMissing &&
      (isWithinSnapshotWindow || !!snapshotForTimeUtc) &&
      !oddsPollingStopped
    );
  }, [
    compId,
    matches.length,
    isLocked,
    oddsMissing,
    isWithinSnapshotWindow,
    snapshotForTimeUtc,
    oddsPollingStopped,
  ]);

  async function saveTip(matchId: string, pickedTeam: string) {
    if (!compId || !userId) return;
    if (isLocked) return;
    if (paymentLocked) {
      toast.error("Tipping is disabled while your payment status is pending.");
      return;
    }

    setSavingMatchId(matchId);
    try {
      const { data: session } = await supabaseBrowser.auth.getSession();
      const token = session.session?.access_token ?? null;
      if (!token) {
        toast.error("Not authenticated. Please sign in again.");
        return;
      }

      const res = await fetch("/api/tips/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          season,
          round,
          competition_id: compId,
          match_id: matchId,
          picked_team: pickedTeam,
        }),
      });

      const json = (await res.json().catch(() => null)) as
        | { error?: string; code?: string; payment_status?: string }
        | null;

      if (!res.ok) {
        if (json?.code === "unpaid_locked") {
          setPaymentLocked(true);
          if (json.payment_status) {
            setPaymentStatus(normalizeRoundPagePaymentStatus(json.payment_status));
          }
        }
        toast.error(json?.error ?? "Could not save tip.");
        return;
      }

      setTipsByMatchId((prev) => ({ ...prev, [matchId]: pickedTeam }));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not save tip.");
    } finally {
      setSavingMatchId(null);
    }
  }

  const oddsLockLabel = useCallback((snapshot: string | null) => {
    return snapshot
      ? `Scoring odds time: ${formatMelbourne(snapshot)} (Melbourne)`
      : "Scoring odds time not set yet (showing latest available odds)";
  }, []);

  // -------- odds loader (LOCKED to round snapshot when present) --------
  const loadOddsForMatchesLocked = useCallback(
    async (
      competitionId: string,
      matchIds: string[],
      totalMatches: number,
      snapshot: string | null
    ) => {
      if (!matchIds.length) return;

      let q = supabaseBrowser
        .from("match_odds")
        .select(
          "match_id, home_team, away_team, home_odds, away_odds, captured_at_utc, snapshot_for_time_utc"
        )
        .eq("competition_id", competitionId)
        .in("match_id", matchIds);

      if (snapshot) {
        q = q.eq("snapshot_for_time_utc", snapshot);
      } else {
        q = q.order("snapshot_for_time_utc", { ascending: false });
      }

      q = q.order("captured_at_utc", { ascending: false });

      const { data: oddsRows, error: oErr } = await q;

      if (oErr) {
        setOddsInfo(`Odds not loaded: ${oErr.message}`);
        return;
      }

      const map = buildRoundPageOddsMap((oddsRows as OddsRow[] | null) ?? []);

      setOddsByMatchId(map);

      const have = Object.keys(map).length;
      setOddsInfo(
        have
          ? `Odds loaded for ${have}/${totalMatches} matches. • ${oddsLockLabel(snapshot)}`
          : `No odds loaded yet for this round. • ${oddsLockLabel(snapshot)}`
      );

      if (have >= totalMatches && totalMatches > 0) {
        setOddsPollingStopped(true);
        setOddsPollingReason("complete");
      }
    },
    [oddsLockLabel]
  );

  // -------- helper: refresh round snapshot --------
  const refreshRoundSnapshot = useCallback(async (competitionId: string, roundId: string) => {
    const { data, error } = await supabaseBrowser
      .from("rounds")
      .select("odds_snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .eq("id", roundId)
      .single();

    if (error || !data) return null;
    const row = data as { odds_snapshot_for_time_utc?: string | null };
    return row.odds_snapshot_for_time_utc ?? null;
  }, []);
  // -------- Poll odds every 90s while missing, up to 60 minutes --------
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

      const jitter = Math.floor(Math.random() * 20_000) - 10_000;
      if (jitter > 0) await new Promise((r) => setTimeout(r, jitter));

      let snap = snapshotForTimeUtc;
      if (!snap && compId && roundId) {
        const fresh = await refreshRoundSnapshot(compId, roundId);
        if (fresh && fresh !== snap) {
          snap = fresh;
          setRoundRow((prev) =>
            prev ? { ...prev, odds_snapshot_for_time_utc: fresh } : prev
          );
        }
      }

      await loadOddsForMatchesLocked(compId!, matchIds, matchIds.length, snap);
    }, POLL_MS);

    return () => clearInterval(interval);
  }, [
    shouldPollOdds,
    compId,
    matches,
    snapshotKey,
    roundRow?.id,
    refreshRoundSnapshot,
    loadOddsForMatchesLocked,
    snapshotForTimeUtc,
  ]);

  useEffect(() => {
    if (!oddsMissing) pollStartRef.current = null;
  }, [oddsMissing, season, round]);

  const showRefreshHint =
    oddsPollingStopped && oddsPollingReason === "timeout" && oddsMissing;
  const showSnapshotMissedAlert = isLocked && !!matches.length && oddsMissing;
  const showRoundSkeleton = !!msg && msg.startsWith("Loading") && !roundRow && matches.length === 0;

  return (
    <main className="ui-page ui-page--content">
      <h1 className="ui-title">
        {getRoundDisplayName(round)} • {season}
      </h1>

      {showRoundSkeleton && <RoundLoadingSkeleton />}

      {roundRow && (
        <div className="ui-card-grid ui-card-grid--3 ui-mt-3">
          <div className="ui-card ui-tone-success">
            <div className="ui-kicker">Tips close</div>
            <div className="ui-value">
              {isLocked ? "Closed" : `Closes in ${lockCountdown}`}
            </div>
            <div className="ui-meta">
              {formatMelbourne(roundRow.lock_time_utc)}
            </div>
          </div>

          <div className="ui-card ui-tone-warning">
            <div className="ui-kicker">Locked odds loaded at</div>
            <div className="ui-value">
              {showLoadedOddsState
                ? formatMelbourne(oddsLoadedAtIso ?? snapshotForTimeUtc ?? oddsExpectedFromIso ?? new Date().toISOString())
                : oddsExpectedFromIso
                ? formatMelbourne(oddsExpectedFromIso)
                : "TBC"}
            </div>
            <div className="ui-meta">
              {!showLoadedOddsState
                ? !snapshotDueMs
                ? "Waiting for lock time"
                : nowMs < snapshotDueMs
                ? `Due in ${oddsExpectedCountdown}`
                : nowMs >= snapshotDueMs && !isLocked
                ? "Loading window is open"
                : "Should already be loaded"
                : null}
            </div>
            {!!matches.length && (
              <div className="ui-caption ui-mt-1">
                Loaded for {oddsHaveCount}/{matches.length} matches
              </div>
            )}
          </div>

          <div className="ui-card ui-tone-info">
            <div className="ui-kicker">Your saved tips</div>
            <div className="ui-value">
              {tippedCount}/{matches.length || 0}
            </div>
          </div>
        </div>
      )}

      {showSnapshotMissedAlert && (
        <div className="ui-card ui-tone-danger ui-mt-3">
          <div style={{ fontWeight: 900, color: "crimson" }}>
            ⚠️ Scoring odds are still missing for this locked round.
          </div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
            We’re still missing odds for <b>{matches.length - oddsHaveCount}</b> match(es).
            Admin: run <b>Snapshot Next Due Round</b> (or force snapshot) to backfill.
          </div>
        </div>
      )}

      {!!matches.length && oddsInfo.startsWith("Odds not loaded:") && <div className="ui-caption ui-mt-2">{oddsInfo}</div>}

      {showRefreshHint && (
        <div className="ui-card ui-tone-info ui-mt-3">
          <div style={{ fontWeight: 800 }}>Still waiting on odds.</div>
          <div className="ui-caption ui-mt-2">
            We’ll stop auto-checking to save requests. Refresh this page to check again.
          </div>
          <button
            onClick={() => window.location.reload()}
            className="ui-btn"
            style={{ marginTop: 10, padding: "10px 12px" }}
          >
            Refresh now
          </button>
        </div>
      )}

      {!!msg && !showRoundSkeleton && <p className="ui-caption ui-mt-4">{msg}</p>}

      {!!matches.length && (
        <div className="ui-card ui-card-soft ui-mt-5">
          <div className="ui-row-between-start">
            <div>
              <div style={{ fontWeight: 700 }}>
                Your tips: {tippedCount} / {matches.length}{" "}
                <span style={{ fontWeight: 600, opacity: 0.85 }}>
                  (Potential score: {potentialScore.toFixed(2)})
                </span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                Tip all matches before the lock time.
              </div>
            </div>

            {isLocked ? (
              <div className="ui-badge ui-badge--locked">LOCKED</div>
            ) : paymentLocked ? (
              <div className="ui-badge ui-badge--locked">PAYMENT LOCK</div>
            ) : (
              <div className="ui-badge ui-badge--open">OPEN</div>
            )}
          </div>

          <div className="ui-grid ui-mt-3" style={{ gap: 6 }}>
            {matches.map((m) => {
              const picked = tipsByMatchId[m.id] ?? null;
              const winner = String(m.winner_team ?? "").trim();
              const resultLabel =
                picked && winner ? (picked === winner ? "Correct" : "Incorrect") : null;
              const resultClassName =
                picked && winner
                  ? picked === winner
                    ? "ui-badge ui-badge--success"
                    : "ui-badge ui-badge--danger"
                  : "";

              return (
                <div
                  key={m.id}
                  style={{
                    fontSize: 13,
                    opacity: 0.9,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <div>
                    {m.home_team} vs {m.away_team} —{" "}
                    {picked ? (
                      <span>
                        tipped <b>{picked}</b>
                      </span>
                    ) : (
                      <span style={{ opacity: 0.6 }}>Not tipped</span>
                    )}
                  </div>

                  {resultLabel && (
                    <span className={resultClassName}>
                      {resultLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {enforceUnpaidTipLock && !isLocked && (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
              Payment status: <b>{paymentStatus}</b>
            </div>
          )}
        </div>
      )}

      {paymentLocked && !isLocked && (
        <div className="ui-card ui-tone-danger ui-mt-3">
          <div style={{ fontWeight: 900, color: "crimson" }}>
            Tipping is locked until payment is marked paid or waived.
          </div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
            Current payment status: <b>{paymentStatus}</b>. Contact an admin if this is incorrect.
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

          return (
            <div
              key={g.id}
              className="ui-card"
              style={{
                marginBottom: 16,
                opacity: isLocked ? 0.98 : 1,
              }}
            >
              <div style={{ fontSize: 14, opacity: 0.8 }}>
                {formatMelbourne(g.commence_time_utc)} • {normalizeVenue(g.venue)}
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  disabled={isLocked || saving || paymentLocked}
                  onClick={() => saveTip(g.id, g.home_team)}
                  style={tipOptionButtonStyle(
                    picked === g.home_team,
                    isLocked || saving || paymentLocked,
                  )}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>{g.home_team}</span>
                    <span style={{ opacity: 0.85 }}>{fmtOdds(homeOdds)}</span>
                  </div>
                </button>

                <button
                  disabled={isLocked || saving || paymentLocked}
                  onClick={() => saveTip(g.id, g.away_team)}
                  style={tipOptionButtonStyle(
                    picked === g.away_team,
                    isLocked || saving || paymentLocked,
                  )}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>{g.away_team}</span>
                    <span style={{ opacity: 0.85 }}>{fmtOdds(awayOdds)}</span>
                  </div>
                </button>
              </div>

              {saving && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>Saving…</div>
              )}

              {!saving && !isLocked && picked && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                  Saved: <b>{picked}</b>
                </div>
              )}

              {!isLocked && paymentLocked && (
                <div style={{ marginTop: 8, fontSize: 12, color: "crimson" }}>
                  Payment pending — tipping disabled.
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
