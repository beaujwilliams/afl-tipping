"use client";

import { useEffect, useMemo, useState } from "react";
import { waitForSession } from "@/lib/session-client";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiBadge, UiButtonLink, UiCard, UiCardGrid } from "@/components/ui";

const CURRENT_SEASON = 2026;

type RoundStatusRow = {
  round_id: string;
  round_number: number;
  lock_time_utc: string | null;
  total_matches: number;
  completed_matches: number;
  round_complete: boolean;
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

function movementColor(movement: number | null | undefined) {
  if ((movement ?? 0) > 0) return "rgb(22, 163, 74)";
  if ((movement ?? 0) < 0) return "rgb(220, 38, 38)";
  return undefined;
}

function getLastChatSeenMs() {
  if (typeof window === "undefined") return 0;
  const v = window.localStorage.getItem("chat_last_seen_ms");
  const n = v ? Number(v) : 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export default function HomePage() {
  const [msg, setMsg] = useState("Loading dashboard...");
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [rounds, setRounds] = useState<RoundStatusRow[]>([]);
  const [me, setMe] = useState<LeaderboardRow | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadMentions, setUnreadMentions] = useState(0);

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

  useEffect(() => {
    if (!userId) return;
    let alive = true;

    async function refreshUnread() {
      const sinceIso = new Date(getLastChatSeenMs()).toISOString();

      const { count, error } = await supabaseBrowser
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .gt("created_at", sinceIso);

      if (!alive) return;
      if (!error) {
        setUnreadChat(count ?? 0);
      }

      const { count: mentionCount, error: mentionErr } = await supabaseBrowser
        .from("chat_message_mentions")
        .select("id", { count: "exact", head: true })
        .eq("mentioned_user_id", userId)
        .gt("created_at", sinceIso);

      if (!alive) return;
      if (mentionErr) {
        if (isMissingRelationError(mentionErr.message, "chat_message_mentions")) {
          setUnreadMentions(0);
        }
        return;
      }

      setUnreadMentions(mentionCount ?? 0);
    }

    refreshUnread();
    const t = setInterval(refreshUnread, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [userId]);

  const currentRound = useMemo(() => {
    if (!rounds.length) return null;

    const isRoundComplete = (r: RoundStatusRow) =>
      Boolean(r.round_complete) ||
      (Number(r.total_matches ?? 0) > 0 &&
        Number(r.completed_matches ?? 0) >= Number(r.total_matches ?? 0));

    const sorted = [...rounds].sort((a, b) => a.round_number - b.round_number);

    // Keep the most recently started unfinished round as "current".
    const inProgress = [...sorted].reverse().find((r) => {
      const lock = melbourneMs(r.lock_time_utc);
      return (
        lock !== null &&
        nowMs >= lock &&
        Number(r.total_matches ?? 0) > 0 &&
        !isRoundComplete(r)
      );
    });
    if (inProgress) return inProgress;

    const nextOpen = sorted.find((r) => {
      const lock = melbourneMs(r.lock_time_utc);
      return lock !== null && nowMs < lock;
    });
    return nextOpen ?? sorted[sorted.length - 1];
  }, [rounds, nowMs]);

  const nextOpenRound = useMemo(() => {
    const sorted = [...rounds].sort((a, b) => a.round_number - b.round_number);
    return (
      sorted.find((r) => {
        const lock = melbourneMs(r.lock_time_utc);
        return lock !== null && nowMs < lock;
      }) ?? null
    );
  }, [rounds, nowMs]);

  const lockMs = melbourneMs(currentRound?.lock_time_utc ?? null);
  const locked = lockMs ? nowMs >= lockMs : false;
  const lockCountdown = lockMs && !locked ? msToCountdown(lockMs - nowMs) : null;
  const tipsPossible = currentRound?.total_matches ?? 0;
  const tipsEntered = currentRound?.my_tips ?? 0;
  const tipsLeft = Math.max(tipsPossible - tipsEntered, 0);
  const currentRoundComplete =
    !!currentRound &&
    (Boolean(currentRound.round_complete) ||
      (Number(currentRound.total_matches ?? 0) > 0 &&
        Number(currentRound.completed_matches ?? 0) >= Number(currentRound.total_matches ?? 0)));
  const lockedRoundStillLive = !!currentRound && locked && !currentRoundComplete;

  const dashboardNotice = useMemo(() => {
    const urgent: string[] = [];
    if (me?.payment_status === "pending") {
      urgent.push("Payment is pending. Tipping may be locked until payment is marked paid.");
    }
    if (currentRound && !locked && tipsLeft > 0) {
      urgent.push(
        `${tipsLeft} tip${tipsLeft === 1 ? "" : "s"} still missing for Round ${currentRound.round_number}.`
      );
    }

    if (urgent.length > 0) {
      return {
        tone: "warning" as const,
        title: "Urgent",
        lines: urgent,
      };
    }

    if (currentRound && lockedRoundStillLive) {
      return {
        tone: "info" as const,
        title: "Round update",
        lines: [
          `Round ${currentRound.round_number} is locked.`,
          nextOpenRound
            ? `Round ${nextOpenRound.round_number} tips are due by ${fmtMelbourneShort(nextOpenRound.lock_time_utc)}.`
            : "The next round tips are now due.",
        ],
      };
    }

    if (currentRound && !locked && tipsLeft === 0) {
      return {
        tone: "success" as const,
        title: "Up to date",
        lines: ["You're all up to date on your tips."],
      };
    }

    return null;
  }, [me?.payment_status, currentRound, locked, lockedRoundStillLive, nextOpenRound, tipsLeft]);

  return (
    <main className="ui-page ui-page--content">
      <div className="ui-page-header">
        <h1 className="ui-title">Welcome back</h1>
        <UiBadge>Season {CURRENT_SEASON}</UiBadge>
      </div>

      {msg && (
        <p className="ui-caption ui-mt-4">
          {msg}
        </p>
      )}

      {!msg && currentRound && (
        <UiCard soft className="ui-mt-4">
          <div className="ui-row-between">
            <div className="ui-kicker">Continue tipping</div>
            <UiBadge tone={locked ? "locked" : "open"}>{locked ? "Locked" : "Open"}</UiBadge>
          </div>
          <div className="ui-value">Round {currentRound.round_number}</div>
          <div className="ui-meta">
            {locked
              ? `Locked ${fmtMelbourneShort(currentRound.lock_time_utc)}`
              : `Locks in ${lockCountdown} (${fmtMelbourneShort(currentRound.lock_time_utc)})`}
          </div>
          <div className="ui-meta">
            Tips entered <b>{tipsEntered}/{tipsPossible}</b>
          </div>
          <UiButtonLink
            href={`/round/${CURRENT_SEASON}/${currentRound.round_number}`}
            style={{ marginTop: 12, padding: "10px 14px" }}
          >
            {locked ? "View round" : "Continue tipping"}
          </UiButtonLink>
        </UiCard>
      )}

      {!msg && dashboardNotice && (
        <UiCard tone={dashboardNotice.tone} className="ui-mt-3">
          <div className="ui-kicker">{dashboardNotice.title}</div>
          <div className="ui-stack" style={{ marginTop: 8, gap: 6 }}>
            {dashboardNotice.lines.map((line) => (
              <div key={line} className="ui-caption">
                {line}
              </div>
            ))}
          </div>
        </UiCard>
      )}

      {!msg && (
        <UiCard soft className="ui-mt-3">
          <div className="ui-kicker">My season snapshot</div>
          <UiCardGrid style={{ marginTop: 10 }}>
            <UiCard>
              <div className="ui-kicker">Rank</div>
              <div className="ui-value">{me ? `#${me.rank}` : "-"}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Total points</div>
              <div className="ui-value">{me ? fmtPts(me.total_points) : "-"}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Behind leader</div>
              <div className="ui-value">
                {me ? (me.behind_leader <= 0 ? "-" : fmtPts(me.behind_leader)) : "-"}
              </div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Unread chat</div>
              <div className="ui-value">{unreadChat}</div>
              <div className="ui-meta">
                @mentions <b>{unreadMentions}</b>
              </div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Movement</div>
              <div className="ui-value" style={{ color: movementColor(me?.movement) }}>
                {me ? movementText(me.movement) : "-"}
              </div>
            </UiCard>
          </UiCardGrid>
        </UiCard>
      )}

    </main>
  );
}
