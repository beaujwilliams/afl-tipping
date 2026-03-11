"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UnpaidTag } from "@/components/UnpaidTag";
import { ChampionCrown } from "@/components/ChampionCrown";

type RoundRow = {
  id: string;
  competition_id: string;
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

type LockedTipPlayer = {
  user_id: string;
  display_name: string | null;
  payment_status?: string | null;
  potential: number;
  picks: Record<string, { team: string; odds: number }>;
};

type LockedTipsResponse = {
  ok: boolean;
  season: number;
  round: number;
  reigning_champion_user_id?: string | null;
  players: LockedTipPlayer[];
};

type PaymentStatus = "paid" | "pending" | "waived";
type MemberRole = "owner" | "admin" | "member";

type UserMembershipRow = {
  competition_id: string;
  role?: string | null;
  payment_status?: string | null;
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

function normalizePaymentStatus(status: string | null | undefined): PaymentStatus {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (s === "paid" || s === "pending" || s === "waived") return s;
  return "pending";
}

function normalizeRole(role: string | null | undefined): MemberRole {
  const r = String(role ?? "")
    .trim()
    .toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
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
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("pending");
  const [paymentLocked, setPaymentLocked] = useState(false);
  const [enforceUnpaidTipLock, setEnforceUnpaidTipLock] = useState(false);

  const [oddsByMatchId, setOddsByMatchId] = useState<Record<string, OddsRow>>({});
  const [oddsInfo, setOddsInfo] = useState<string>("");

  // NEW: everyone's tips table after lock
  const [lockedTips, setLockedTips] = useState<LockedTipPlayer[] | null>(null);
  const [lockedTipsMsg, setLockedTipsMsg] = useState<string>("");
  const [reigningChampionUserId, setReigningChampionUserId] = useState<string | null>(null);
  const [lockedTipsSearch, setLockedTipsSearch] = useState("");
  const [showLockedTipsInfo, setShowLockedTipsInfo] = useState(false);
  const [expandedLockedTipUserIds, setExpandedLockedTipUserIds] = useState<Record<string, boolean>>({});
  const lockedTipsRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ✅ NEW: tip breakdown once locked
  const [tipBreakdownByMatch, setTipBreakdownByMatch] = useState<
    Record<string, Record<string, number>>
  >({});

  // Polling UX
  const [oddsPollingStopped, setOddsPollingStopped] = useState(false);
  const [oddsPollingReason, setOddsPollingReason] = useState<
    "" | "complete" | "timeout"
  >("");

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
      alert("Tipping is disabled while your payment status is pending.");
      return;
    }

    setSavingMatchId(matchId);
    try {
      const { data: session } = await supabaseBrowser.auth.getSession();
      const token = session.session?.access_token ?? null;
      if (!token) {
        alert("Not authenticated. Please sign in again.");
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
            setPaymentStatus(normalizePaymentStatus(json.payment_status));
          }
        }
        alert(json?.error ?? "Could not save tip.");
        return;
      }

      setTipsByMatchId((prev) => ({ ...prev, [matchId]: pickedTeam }));
    } finally {
      setSavingMatchId(null);
    }
  }

  function oddsLockLabel(snapshot: string | null) {
    return snapshot
      ? `Scoring odds time: ${formatMelbourne(snapshot)} (Melbourne)`
      : "Scoring odds time not set yet (showing latest available odds)";
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

    const map: Record<string, OddsRow> = {};
    (oddsRows as OddsRow[] | null)?.forEach((row) => {
      if (!map[row.match_id]) map[row.match_id] = row;
    });

    setOddsByMatchId(map);

    const have = Object.keys(map).length;
    setOddsInfo(
      have
        ? `Odds loaded for ${have}/${totalMatches} matches. • ${oddsLockLabel(
            snapshot
          )}`
        : `No odds loaded yet for this round. • ${oddsLockLabel(snapshot)}`
    );

    if (have >= totalMatches && totalMatches > 0) {
      setOddsPollingStopped(true);
      setOddsPollingReason("complete");
    }
  }

  // -------- helper: refresh round snapshot --------
  async function refreshRoundSnapshot(competitionId: string, roundId: string) {
    const { data, error } = await supabaseBrowser
      .from("rounds")
      .select("odds_snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .eq("id", roundId)
      .single();

    if (error || !data) return null;
    const row = data as { odds_snapshot_for_time_utc?: string | null };
    return row.odds_snapshot_for_time_utc ?? null;
  }

  useEffect(() => {
    (async () => {
      setMsg("Loading…");
      setOddsInfo("");
      setOddsByMatchId({});
      setTipsByMatchId({});
      setOddsPollingStopped(false);
      setOddsPollingReason("");
      setTipBreakdownByMatch({});
      setLockedTips(null);
      setLockedTipsMsg("");
      setReigningChampionUserId(null);
      setLockedTipsSearch("");
      setShowLockedTipsInfo(false);
      setExpandedLockedTipUserIds({});

      const { data: auth } = await supabaseBrowser.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }
      setUserId(auth.user.id);

      const membershipsRes = await supabaseBrowser
        .from("memberships")
        .select("competition_id, role, payment_status")
        .eq("user_id", auth.user.id);

      if (membershipsRes.error) {
        setMsg(`Could not load memberships: ${membershipsRes.error.message}`);
        return;
      }

      const memberships = (membershipsRes.data ?? []) as UserMembershipRow[];
      const competitionIds = Array.from(
        new Set(memberships.map((m) => String(m.competition_id)))
      );
      const membershipByCompetition: Record<string, UserMembershipRow> = {};
      memberships.forEach((m) => {
        membershipByCompetition[String(m.competition_id)] = m;
      });

      let roundCandidatesQuery = supabaseBrowser
        .from("rounds")
        .select("id, competition_id, season, round_number, lock_time_utc, odds_snapshot_for_time_utc")
        .eq("season", season)
        .eq("round_number", round);

      if (competitionIds.length) {
        roundCandidatesQuery = roundCandidatesQuery.in("competition_id", competitionIds);
      }

      let roundCandidatesRes = await roundCandidatesQuery;

      if ((!roundCandidatesRes.data || roundCandidatesRes.data.length === 0) && competitionIds.length) {
        roundCandidatesRes = await supabaseBrowser
          .from("rounds")
          .select("id, competition_id, season, round_number, lock_time_utc, odds_snapshot_for_time_utc")
          .eq("season", season)
          .eq("round_number", round);
      }

      if (roundCandidatesRes.error) {
        setMsg(`Could not load round: ${roundCandidatesRes.error.message}`);
        return;
      }

      const roundCandidates = (roundCandidatesRes.data ?? []) as RoundRow[];
      if (!roundCandidates.length) {
        setMsg("Round not found.");
        return;
      }

      const rolePriority = (compId: string) => {
        const role = normalizeRole(membershipByCompetition[compId]?.role ?? null);
        if (role === "owner") return 0;
        if (role === "admin") return 1;
        if (role === "member") return 2;
        return 3;
      };

      const pickedRound = [...roundCandidates].sort((a, b) => {
        const roleDiff = rolePriority(a.competition_id) - rolePriority(b.competition_id);
        if (roleDiff !== 0) return roleDiff;
        return String(a.competition_id).localeCompare(String(b.competition_id));
      })[0];

      const competitionId = String(pickedRound.competition_id);
      setCompId(competitionId);

      let memberPaymentStatus: PaymentStatus = "pending";
      let memberRole: MemberRole = "member";
      let enforceLock = false;

      const membership = membershipByCompetition[competitionId] ?? null;
      if (membership) {
        memberRole = normalizeRole(
          membership.role ?? null
        );
        memberPaymentStatus = normalizePaymentStatus(
          membership.payment_status ?? null
        );
      }

      const compSettings = await supabaseBrowser
        .from("competitions")
        .select("enforce_unpaid_tip_lock")
        .eq("id", competitionId)
        .single();

      if (!compSettings.error && compSettings.data) {
        enforceLock = !!(
          compSettings.data as { enforce_unpaid_tip_lock?: boolean | null }
        ).enforce_unpaid_tip_lock;
      } else if (
        compSettings.error &&
        isMissingColumnError(compSettings.error.message, "enforce_unpaid_tip_lock")
      ) {
        enforceLock = false;
      }

      setPaymentStatus(memberPaymentStatus);
      setEnforceUnpaidTipLock(enforceLock);
      setPaymentLocked(
        enforceLock &&
          memberRole !== "owner" &&
          memberRole !== "admin" &&
          memberPaymentStatus === "pending"
      );

      setRoundRow(pickedRound as RoundRow);

      const { data: m, error: mErr } = await supabaseBrowser
        .from("matches")
        .select(
          "id, commence_time_utc, home_team, away_team, venue, status, winner_team"
        )
        .eq("round_id", pickedRound.id)
        .order("commence_time_utc", { ascending: true });

      if (mErr) {
        setMsg(`Error loading matches: ${mErr.message}`);
        return;
      }

      const matchList = (m ?? []) as MatchRow[];
      setMatches(matchList);
      setMsg("");

      const matchIds = matchList.map((x) => x.id);

      // Load tips (current user)
      if (matchIds.length) {
        const { data: tips, error: tErr } = await supabaseBrowser
          .from("tips")
          .select("match_id, picked_team")
          .eq("competition_id", competitionId)
          .eq("user_id", auth.user.id)
          .in("match_id", matchIds);

        if (!tErr) {
          const map: Record<string, string> = {};
          (tips as TipRow[] | null)?.forEach((t) => (map[t.match_id] = t.picked_team));
          setTipsByMatchId(map);
        }
      }

      // Load odds
      await loadOddsForMatchesLocked(
        competitionId,
        matchIds,
        matchIds.length,
        pickedRound.odds_snapshot_for_time_utc ?? null
      );
    })();
  }, [season, round]);

  // ✅ when round is locked, fetch tip breakdown per match
  useEffect(() => {
    if (!isLocked) return;

    (async () => {
      try {
        const res = await fetch(
          `/api/round-tip-breakdown?season=${encodeURIComponent(
            String(season)
          )}&round=${encodeURIComponent(String(round))}${compId ? `&competition_id=${encodeURIComponent(compId)}` : ""}`,
          { cache: "no-store" }
        );
        const json = (await res
          .json()
          .catch(() => null)) as TipBreakdownResponse | null;
        if (res.ok && json?.ok && json.byMatch) {
          setTipBreakdownByMatch(json.byMatch);
        }
      } catch {
        // ignore
      }
    })();
  }, [isLocked, season, round, compId]);

  // ✅ when round is locked, fetch "everyone's tips" table
  useEffect(() => {
    if (!isLocked) return;
    if (lockedTips !== null) return; // already fetched (or already failed but we don't want to spam)

    (async () => {
      try {
        setLockedTipsMsg("");
        const res = await fetch(
          `/api/round-locked-tips?season=${encodeURIComponent(
            String(season)
          )}&round=${encodeURIComponent(String(round))}${compId ? `&competition_id=${encodeURIComponent(compId)}` : ""}`,
          { cache: "no-store" }
        );
        const json = (await res
          .json()
          .catch(() => null)) as LockedTipsResponse | null;

        if (!res.ok || !json?.ok) {
          setLockedTips([]);
          setLockedTipsMsg("Could not load everyone’s tips.");
          return;
        }

        setReigningChampionUserId(
          typeof json.reigning_champion_user_id === "string" ? json.reigning_champion_user_id : null
        );

        const list = Array.isArray(json.players) ? json.players : [];
        // sort: highest potential first
        list.sort((a, b) => Number(b.potential ?? 0) - Number(a.potential ?? 0));
        setLockedTips(list);
      } catch {
        setLockedTips([]);
        setLockedTipsMsg("Could not load everyone’s tips.");
      }
    })();
  }, [isLocked, season, round, lockedTips, compId]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPollOdds, compId, matches, snapshotKey, roundRow?.id]);

  useEffect(() => {
    if (!oddsMissing) pollStartRef.current = null;
  }, [oddsMissing, season, round]);

  const showRefreshHint =
    oddsPollingStopped && oddsPollingReason === "timeout" && oddsMissing;
  const showSnapshotMissedAlert = isLocked && !!matches.length && oddsMissing;

  const matchTitleById = useMemo(() => {
    const out: Record<string, string> = {};
    matches.forEach((m) => {
      out[m.id] = `${m.home_team} vs ${m.away_team}`;
    });
    return out;
  }, [matches]);

  const lockedTipsRankByUserId = useMemo(() => {
    const out: Record<string, number> = {};
    (lockedTips ?? []).forEach((p, idx) => {
      out[p.user_id] = idx + 1;
    });
    return out;
  }, [lockedTips]);

  const visibleLockedTips = useMemo(() => {
    if (!lockedTips) return [] as Array<
      LockedTipPlayer & {
        row_rank: number;
        picks_count: number;
        underdog_count: number;
      }
    >;

    const q = lockedTipsSearch.trim().toLowerCase();

    return lockedTips
      .filter((p) => {
        if (!q) return true;
        const name = String(p.display_name ?? "").toLowerCase();
        const id = String(p.user_id).toLowerCase();
        return name.includes(q) || id.includes(q);
      })
      .map((p) => {
        let picksCount = 0;
        let underdogCount = 0;

        matches.forEach((m) => {
          const team = p.picks?.[m.id]?.team ?? "";
          if (!team) return;
          picksCount += 1;

          const odds = oddsByMatchId[m.id];
          if (odds) {
            const pickedOdds =
              team === m.home_team
                ? Number(odds.home_odds ?? 0)
                : team === m.away_team
                  ? Number(odds.away_odds ?? 0)
                  : 0;
            const otherOdds =
              team === m.home_team
                ? Number(odds.away_odds ?? 0)
                : team === m.away_team
                  ? Number(odds.home_odds ?? 0)
                  : 0;

            if (pickedOdds > 0 && otherOdds > 0 && pickedOdds > otherOdds) {
              underdogCount += 1;
            }
          }
        });

        return {
          ...p,
          row_rank: lockedTipsRankByUserId[p.user_id] ?? 0,
          picks_count: picksCount,
          underdog_count: underdogCount,
        };
      });
  }, [
    lockedTips,
    lockedTipsSearch,
    matches,
    oddsByMatchId,
    lockedTipsRankByUserId,
  ]);

  const allVisibleExpanded =
    visibleLockedTips.length > 0 &&
    visibleLockedTips.every((p) => !!expandedLockedTipUserIds[p.user_id]);

  function jumpToMyTips() {
    if (!userId || !lockedTips) return;
    const me = lockedTips.find((p) => p.user_id === userId);
    if (!me) return;

    setLockedTipsSearch("");
    setExpandedLockedTipUserIds((prev) => ({ ...prev, [userId]: true }));

    setTimeout(() => {
      const node = lockedTipsRowRefs.current[userId];
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  function toggleExpandAllVisible() {
    if (!visibleLockedTips.length) return;

    setExpandedLockedTipUserIds((prev) => {
      const next = { ...prev };

      if (allVisibleExpanded) {
        visibleLockedTips.forEach((p) => {
          delete next[p.user_id];
        });
      } else {
        visibleLockedTips.forEach((p) => {
          next[p.user_id] = true;
        });
      }

      return next;
    });
  }

  return (
    <main className="ui-page ui-page--content">
      <h1 className="ui-title">
        Round {round} • {season}
      </h1>

      {roundRow && (
        <div
          className="ui-card-grid ui-card-grid--3"
          style={{
            marginTop: 12,
          }}
        >
          <div className="ui-card ui-tone-success">
            <div className="ui-kicker">Tips close</div>
            <div className="ui-value">
              {formatMelbourne(roundRow.lock_time_utc)}
            </div>
            <div className="ui-meta">
              {isLocked ? "Closed" : `Closes in ${lockCountdown}`}
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
              <div className="ui-caption" style={{ marginTop: 4 }}>
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
        <div
          className="ui-card ui-tone-danger"
          style={{ marginTop: 12 }}
        >
          <div style={{ fontWeight: 900, color: "crimson" }}>
            ⚠️ Scoring odds are still missing for this locked round.
          </div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
            We’re still missing odds for <b>{matches.length - oddsHaveCount}</b> match(es).
            Admin: run <b>Snapshot Next Due Round</b> (or force snapshot) to backfill.
          </div>
        </div>
      )}

      {!!matches.length && oddsInfo.startsWith("Odds not loaded:") && (
        <div style={{ marginTop: 8 }} className="ui-caption">{oddsInfo}</div>
      )}

      {showRefreshHint && (
        <div
          className="ui-card ui-tone-info"
          style={{ marginTop: 12 }}
        >
          <div style={{ fontWeight: 800 }}>Still waiting on odds.</div>
          <div style={{ marginTop: 6 }} className="ui-caption">
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

      {msg && <p style={{ marginTop: 16 }} className="ui-caption">{msg}</p>}

      {!!matches.length && (
        <div
          className="ui-card ui-card-soft"
          style={{
            marginTop: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
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

          {enforceUnpaidTipLock && !isLocked && (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
              Payment status: <b>{paymentStatus}</b>
            </div>
          )}
        </div>
      )}

      {paymentLocked && !isLocked && (
        <div
          className="ui-card ui-tone-danger"
          style={{ marginTop: 12 }}
        >
          <div style={{ fontWeight: 900, color: "crimson" }}>
            Tipping is locked until payment is marked paid or waived.
          </div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
            Current payment status: <b>{paymentStatus}</b>. Contact an admin if this is incorrect.
          </div>
        </div>
      )}

      {/* ✅ NEW: Everyone’s tips section (only after lock) */}
      {isLocked && (
        <div
          className="ui-card ui-card-soft"
          style={{
            marginTop: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Everyone’s tips</div>
            <div className="ui-caption">
              Sorted by potential total
            </div>
          </div>

          {lockedTipsMsg && (
            <div style={{ marginTop: 10 }} className="ui-caption">
              {lockedTipsMsg}
            </div>
          )}

          {lockedTips === null ? (
            <div style={{ marginTop: 10 }} className="ui-caption">
              Loading everyone’s tips…
            </div>
          ) : lockedTips.length === 0 ? (
            <div style={{ marginTop: 10 }} className="ui-caption">
              No tips found (or tips table not available yet).
            </div>
          ) : (
            <>
              <div className="ui-row-wrap" style={{ marginTop: 12, alignItems: "center", gap: 10 }}>
                <input
                  value={lockedTipsSearch}
                  onChange={(e) => setLockedTipsSearch(e.target.value)}
                  placeholder="Search member..."
                  className="ui-input"
                />

                <button
                  type="button"
                  onClick={() => setShowLockedTipsInfo((prev) => !prev)}
                  className="ui-btn"
                >
                  {showLockedTipsInfo ? "Hide info" : "What do these mean?"}
                </button>

                <button
                  type="button"
                  onClick={jumpToMyTips}
                  disabled={!userId || !(lockedTips ?? []).some((p) => p.user_id === userId)}
                  className="ui-btn"
                >
                  Jump to me
                </button>

                <button
                  type="button"
                  onClick={toggleExpandAllVisible}
                  disabled={visibleLockedTips.length === 0}
                  className="ui-btn"
                >
                  {allVisibleExpanded ? "Collapse all" : "Expand all"}
                </button>
              </div>

              {showLockedTipsInfo && (
                <div className="ui-card" style={{ marginTop: 10, padding: "10px 12px", fontSize: 12, lineHeight: 1.45 }}>
                  <div style={{ fontWeight: 900 }}>Underdogs tipped</div>
                  <div style={{ opacity: 0.88 }}>
                    Count of picks where the selected team had higher odds than the opponent.
                  </div>
                </div>
              )}

              {visibleLockedTips.length === 0 ? (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                  No members match your search.
                </div>
              ) : (
                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  {visibleLockedTips.map((p) => {
                    const isExpanded = !!expandedLockedTipUserIds[p.user_id];

                    const picksForUser = matches.filter((m) => !!p.picks?.[m.id]);

                    return (
                      <div
                        className="ui-card"
                        key={p.user_id}
                        ref={(node) => {
                          lockedTipsRowRefs.current[p.user_id] = node;
                        }}
                        style={{
                          padding: 0,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedLockedTipUserIds((prev) => ({
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
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontWeight: 900 }}>
                              <span style={{ opacity: 0.78, minWidth: 22 }}>#{p.row_rank}</span>
                              <ChampionCrown isChampion={p.user_id === reigningChampionUserId} />
                              <span>{p.display_name?.trim() ? p.display_name : "(no display name)"}</span>
                              <UnpaidTag paymentStatus={p.payment_status ?? null} />
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.95 }}>
                              Potential <b>{Number(p.potential ?? 0).toFixed(2)}</b>
                            </div>
                          </div>

                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12, opacity: 0.9 }}>
                            <span>
                              Underdogs tipped: <b>{p.underdog_count}</b>/<b>{p.picks_count}</b>
                            </span>
                            <span>{isExpanded ? "Hide picks ▲" : "Show picks ▼"}</span>
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
                                const pick = p.picks?.[m.id] ?? null;

                                return (
                                  <div
                                    key={m.id}
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
                              <div style={{ opacity: 0.9, display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                      <span>{matchTitleById[m.id] ?? `${m.home_team} vs ${m.away_team}`}</span>
                                    </div>
                                    <div style={{ fontWeight: 800, textAlign: "right" }}>
                                      {pick ? (
                                        <>
                                          {pick.team} <span style={{ opacity: 0.9 }}>({fmtOdds(pick.odds)})</span>
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
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        {matches.map((g) => {
          const picked = tipsByMatchId[g.id] ?? null;
          const saving = savingMatchId === g.id;

          const odds = oddsByMatchId[g.id];
          const homeOdds = odds ? odds.home_odds : null;
          const awayOdds = odds ? odds.away_odds : null;

          // ✅ tip breakdown counts (only shown when locked)
          const breakdown = tipBreakdownByMatch[g.id] ?? {};
          const homeTips = breakdown[g.home_team] ?? 0;
          const awayTips = breakdown[g.away_team] ?? 0;

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

              {/* ✅ show tip breakdown once locked */}
              {isLocked && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                  Tip breakdown: <b>{g.home_team}</b> {homeTips} • <b>{g.away_team}</b> {awayTips}
                </div>
              )}

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
