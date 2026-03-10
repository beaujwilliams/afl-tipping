"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { waitForSession } from "@/lib/session-client";

const CURRENT_SEASON = 2026;

type RoundStatusRow = {
  round_id: string;
  round_number: number;
  lock_time_utc: string | null;
  total_matches: number;
  my_tips: number;
};

type RoundStatusResponse = {
  ok: boolean;
  rounds: RoundStatusRow[];
  error?: string;
};

type LeaderboardRow = {
  user_id: string;
  rank: number;
  total_points: number;
  movement: number;
  behind_leader: number;
  payment_status?: string | null;
};

type LeaderboardResponse = {
  ok: boolean;
  rows: LeaderboardRow[];
  error?: string;
};

function melbourneMs(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function fmtMelbourneShort(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
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

function fmtPts(n: number) {
  return Number(n ?? 0).toFixed(2);
}

function movementText(movement: number) {
  if (movement > 0) return `Up ${movement}`;
  if (movement < 0) return `Down ${Math.abs(movement)}`;
  return "No change";
}

export default function HomePage() {
  const [msg, setMsg] = useState("Loading dashboard...");
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [rounds, setRounds] = useState<RoundStatusRow[]>([]);
  const [me, setMe] = useState<LeaderboardRow | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;

    async function init() {
      const session = await waitForSession(3500, 180);
      if (!alive) return;

      if (!session) {
        window.location.href = "/login";
        return;
      }

      setToken(session.access_token);
      setUserId(session.user.id);
      setMsg("");
    }

    init();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!token || !userId) return;

    let alive = true;

    async function loadDashboard() {
      setMsg("Loading dashboard...");

      try {
        const [statusRes, leaderboardRes] = await Promise.all([
          fetch(`/api/round-tip-status?season=${encodeURIComponent(String(CURRENT_SEASON))}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch(`/api/leaderboard?season=${encodeURIComponent(String(CURRENT_SEASON))}`, {
            cache: "no-store",
          }),
        ]);

        const statusJson = (await statusRes.json().catch(() => null)) as RoundStatusResponse | null;
        const leaderboardJson = (await leaderboardRes.json().catch(() => null)) as LeaderboardResponse | null;

        if (!alive) return;

        if (!statusRes.ok || !statusJson?.ok) {
          setMsg(statusJson?.error ?? "Could not load your round status.");
          return;
        }

        if (!leaderboardRes.ok || !leaderboardJson?.ok) {
          setMsg(leaderboardJson?.error ?? "Could not load your leaderboard snapshot.");
          return;
        }

        setRounds(statusJson.rounds ?? []);
        setMe((leaderboardJson.rows ?? []).find((r) => r.user_id === userId) ?? null);
        setMsg("");
      } catch {
        if (!alive) return;
        setMsg("Could not load dashboard.");
      }
    }

    loadDashboard();

    return () => {
      alive = false;
    };
  }, [token, userId]);

  const currentRound = useMemo(() => {
    if (!rounds.length) return null;
    const sorted = [...rounds].sort((a, b) => a.round_number - b.round_number);
    const nextOpen = sorted.find((r) => {
      const lock = melbourneMs(r.lock_time_utc);
      return lock !== null && nowMs < lock;
    });
    return nextOpen ?? sorted[sorted.length - 1];
  }, [rounds, nowMs]);

  const lockMs = melbourneMs(currentRound?.lock_time_utc ?? null);
  const locked = lockMs ? nowMs >= lockMs : false;
  const lockCountdown = lockMs && !locked ? msToCountdown(lockMs - nowMs) : null;
  const tipsPossible = currentRound?.total_matches ?? 0;
  const tipsEntered = currentRound?.my_tips ?? 0;
  const tipsLeft = Math.max(tipsPossible - tipsEntered, 0);

  const alerts = useMemo(() => {
    const out: string[] = [];
    if (me?.payment_status === "pending") {
      out.push("Payment is pending. Tipping may be locked until payment is marked paid.");
    }
    if (currentRound && locked) {
      out.push(`Round ${currentRound.round_number} is locked.`);
    }
    if (currentRound && !locked && tipsLeft > 0) {
      out.push(`${tipsLeft} tip${tipsLeft === 1 ? "" : "s"} still missing for Round ${currentRound.round_number}.`);
    }
    if (currentRound && !locked && tipsLeft === 0) {
      out.push(`All tips entered for Round ${currentRound.round_number}.`);
    }
    return out;
  }, [me?.payment_status, currentRound, locked, tipsLeft]);

  return (
    <main className="ui-page ui-page--content">
      <div className="ui-page-header">
        <h1 className="ui-title">Welcome back</h1>
        <div className="ui-caption">Season {CURRENT_SEASON}</div>
      </div>

      {msg && (
        <p style={{ marginTop: 14 }} className="ui-caption">
          {msg}
        </p>
      )}

      {!msg && currentRound && (
        <div className="ui-card ui-card-soft" style={{ marginTop: 16 }}>
          <div className="ui-kicker">Continue tipping</div>
          <div className="ui-value">Round {currentRound.round_number}</div>
          <div className="ui-meta">
            {locked
              ? `Locked ${fmtMelbourneShort(currentRound.lock_time_utc)}`
              : `Locks in ${lockCountdown} (${fmtMelbourneShort(currentRound.lock_time_utc)})`}
          </div>
          <div className="ui-meta">
            Tips entered <b>{tipsEntered}/{tipsPossible}</b>
          </div>
          <Link
            href={`/round/${CURRENT_SEASON}/${currentRound.round_number}`}
            className="ui-btn"
            style={{ marginTop: 12, padding: "10px 14px" }}
          >
            {locked ? "View round" : "Continue tipping"}
          </Link>
        </div>
      )}

      {!msg && alerts.length > 0 && (
        <div className="ui-card ui-tone-warning" style={{ marginTop: 12 }}>
          <div className="ui-kicker">Urgent</div>
          <div className="ui-stack" style={{ marginTop: 8, gap: 6 }}>
            {alerts.map((alert) => (
              <div key={alert} className="ui-caption">
                {alert}
              </div>
            ))}
          </div>
        </div>
      )}

      {!msg && (
        <div className="ui-card ui-card-soft" style={{ marginTop: 12 }}>
          <div className="ui-kicker">My season snapshot</div>
          <div className="ui-card-grid ui-card-grid--3" style={{ marginTop: 10 }}>
            <div className="ui-card">
              <div className="ui-kicker">Rank</div>
              <div className="ui-value">{me ? `#${me.rank}` : "-"}</div>
            </div>
            <div className="ui-card">
              <div className="ui-kicker">Total points</div>
              <div className="ui-value">{me ? fmtPts(me.total_points) : "-"}</div>
            </div>
            <div className="ui-card">
              <div className="ui-kicker">Behind leader</div>
              <div className="ui-value">
                {me ? (me.behind_leader <= 0 ? "-" : fmtPts(me.behind_leader)) : "-"}
              </div>
            </div>
          </div>
          <div className="ui-meta" style={{ marginTop: 10 }}>
            Movement: <b>{me ? movementText(me.movement) : "-"}</b>
          </div>
        </div>
      )}

    </main>
  );
}
