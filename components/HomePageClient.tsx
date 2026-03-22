"use client";

import { useEffect, useMemo, useState } from "react";
import { useChatActivity } from "@/components/ChatActivityProvider";
import { UiBadge, UiButtonLink, UiCard, UiCardGrid, UiSectionHeader } from "@/components/ui";

const CURRENT_SEASON = 2026;
const LIVE_SIGNAL_GRACE_MS = 6 * 60 * 60 * 1000;

export type HomeRoundStatusRow = {
  round_id: string;
  round_number: number;
  lock_time_utc: string | null;
  total_matches: number;
  completed_matches: number;
  round_complete: boolean;
  my_tips: number;
};

export type HomeLeaderboardRow = {
  user_id: string;
  rank: number;
  total_points: number;
  movement: number;
  behind_leader: number;
  payment_status?: string | null;
};

type DashboardReminder = {
  id: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
};

type HomePageClientProps = {
  welcomeName: string;
  rounds: HomeRoundStatusRow[];
  me: HomeLeaderboardRow | null;
  initialMessage?: string | null;
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

function pluralize(count: number, single: string, plural: string) {
  return count === 1 ? single : plural;
}

function isRoundComplete(row: HomeRoundStatusRow | null | undefined) {
  if (!row) return false;
  return (
    Boolean(row.round_complete) ||
    (Number(row.total_matches ?? 0) > 0 &&
      Number(row.completed_matches ?? 0) >= Number(row.total_matches ?? 0))
  );
}

export default function HomePageClient({
  welcomeName,
  rounds,
  me,
  initialMessage,
}: HomePageClientProps) {
  const msg = initialMessage ?? "";
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { unreadChat, unreadMentions } = useChatActivity();

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const sortedRounds = useMemo(
    () => [...rounds].sort((a, b) => a.round_number - b.round_number),
    [rounds]
  );

  const liveRound = useMemo(() => {
    if (!sortedRounds.length) return null;
    return (
      [...sortedRounds].reverse().find((r) => {
        const lock = melbourneMs(r.lock_time_utc);
        if (lock === null || nowMs < lock) return false;
        if (Number(r.total_matches ?? 0) <= 0) return false;
        if (isRoundComplete(r)) return false;

        const completedMatches = Number(r.completed_matches ?? 0);
        const recentlyLocked = nowMs - lock <= LIVE_SIGNAL_GRACE_MS;
        return completedMatches > 0 || recentlyLocked;
      }) ?? null
    );
  }, [sortedRounds, nowMs]);

  const nextOpenRound = useMemo(() => {
    return (
      sortedRounds.find((r) => {
        const lock = melbourneMs(r.lock_time_utc);
        return lock !== null && nowMs < lock;
      }) ?? null
    );
  }, [sortedRounds, nowMs]);

  const latestCompletedRound = useMemo(
    () => [...sortedRounds].reverse().find((r) => isRoundComplete(r)) ?? null,
    [sortedRounds]
  );

  const currentRound = useMemo(() => {
    if (liveRound) return liveRound;
    if (nextOpenRound) return nextOpenRound;
    return sortedRounds[sortedRounds.length - 1] ?? null;
  }, [liveRound, nextOpenRound, sortedRounds]);

  const lockMs = melbourneMs(currentRound?.lock_time_utc ?? null);
  const locked = lockMs ? nowMs >= lockMs : false;
  const tipsPossible = currentRound?.total_matches ?? 0;
  const tipsEntered = currentRound?.my_tips ?? 0;
  const tipsLeft = Math.max(tipsPossible - tipsEntered, 0);
  const lockedRoundStillLive = !!liveRound;
  const liveRoundProgressPct =
    liveRound && liveRound.total_matches > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((Number(liveRound.completed_matches ?? 0) / Number(liveRound.total_matches ?? 1)) * 100)
          )
        )
      : 0;

  const primaryTipRound = useMemo(() => {
    if (currentRound && !locked) return currentRound;
    if (nextOpenRound) return nextOpenRound;
    return currentRound;
  }, [currentRound, locked, nextOpenRound]);

  const primaryRoundLockMs = melbourneMs(primaryTipRound?.lock_time_utc ?? null);
  const primaryRoundLocked = primaryRoundLockMs ? nowMs >= primaryRoundLockMs : false;
  const primaryRoundCountdown =
    primaryRoundLockMs && !primaryRoundLocked ? msToCountdown(primaryRoundLockMs - nowMs) : null;
  const primaryTipsPossible = primaryTipRound?.total_matches ?? 0;
  const primaryTipsEntered = primaryTipRound?.my_tips ?? 0;
  const primaryTipsLeft = Math.max(primaryTipsPossible - primaryTipsEntered, 0);
  const showUpToDateTile = !!(currentRound && !locked && tipsLeft === 0);

  const reminders = useMemo(() => {
    const items: DashboardReminder[] = [];

    if (primaryTipRound && !primaryRoundLocked && primaryTipsLeft > 0) {
      items.push({
        id: "missing-tips",
        title: `Finish Round ${primaryTipRound.round_number}`,
        detail: `${primaryTipsLeft} ${pluralize(primaryTipsLeft, "tip", "tips")} left before ${fmtMelbourneShort(primaryTipRound.lock_time_utc)}.`,
        href: `/round/${CURRENT_SEASON}/${primaryTipRound.round_number}`,
        cta: "Finish tipping",
      });
    }

    if (me?.payment_status === "pending") {
      items.push({
        id: "payment-pending",
        title: "Payment pending",
        detail: "Your entry is still marked pending and tipping may be locked until this is updated.",
        href: "/profile",
        cta: "View profile",
      });
    }

    if (unreadMentions > 0) {
      items.push({
        id: "chat-mentions",
        title: `${unreadMentions} ${pluralize(unreadMentions, "@mention", "@mentions")} waiting`,
        detail: "Jump back into chat and catch up on messages directed at you.",
        href: "/chat",
        cta: "Open chat",
      });
    } else if (unreadChat > 0) {
      items.push({
        id: "chat-unread",
        title: `${unreadChat} unread chat ${pluralize(unreadChat, "message", "messages")}`,
        detail: "There’s new chat activity since you last checked in.",
        href: "/chat",
        cta: "Read chat",
      });
    }

    return items;
  }, [
    me?.payment_status,
    primaryRoundLocked,
    primaryTipRound,
    primaryTipsLeft,
    unreadChat,
    unreadMentions,
  ]);

  const attentionReminders = useMemo(
    () => reminders.filter((item) => item.id !== "missing-tips"),
    [reminders]
  );

  const dashboardNotice = useMemo(() => {
    if (liveRound && lockedRoundStillLive) {
      return {
        tone: "info" as const,
        title: "Round update",
        lines: [
          `Round ${liveRound.round_number} is locked.`,
          nextOpenRound
            ? `Round ${nextOpenRound.round_number} tips are due by ${fmtMelbourneShort(nextOpenRound.lock_time_utc)}.`
            : "The next round tips are now due.",
        ],
      };
    }

    return null;
  }, [liveRound, lockedRoundStillLive, nextOpenRound]);

  return (
    <main className="ui-page ui-page--content">
      <div className="ui-page-header">
        <h1 className="ui-title">{welcomeName ? `Welcome back, ${welcomeName}` : "Welcome back"}</h1>
        <UiBadge>Season {CURRENT_SEASON}</UiBadge>
      </div>

      {msg && (
        <p className="ui-caption ui-mt-4">
          {msg}
        </p>
      )}

      {!msg && currentRound && (
        <div
          className={`dashboard-top-grid ui-mt-4${attentionReminders.length === 0 ? " dashboard-top-grid--single" : ""}`}
        >
          <UiCard soft className="dashboard-hero">
            <div className="ui-row-between">
              <div className="ui-kicker">Action center</div>
              <UiBadge tone={primaryRoundLocked ? "locked" : "open"}>
                {primaryRoundLocked ? "Locked" : "Open"}
              </UiBadge>
            </div>

            <div className="dashboard-hero-title">
              {liveRound && nextOpenRound
                ? `Round ${liveRound.round_number} is live. Round ${nextOpenRound.round_number} closes in ${primaryRoundCountdown}.`
                : liveRound
                ? `Round ${liveRound.round_number} is live.`
                : primaryTipRound && !primaryRoundLocked
                ? `Round ${primaryTipRound.round_number} closes in ${primaryRoundCountdown}.`
                : primaryTipRound
                ? `Round ${primaryTipRound.round_number} is locked.`
                : "No round loaded."}
            </div>

            {primaryTipRound && (
              <div className="dashboard-hero-meta">
                {primaryRoundLocked
                  ? `Locked ${fmtMelbourneShort(primaryTipRound.lock_time_utc)}`
                  : `${fmtMelbourneShort(primaryTipRound.lock_time_utc)} in Melbourne time`}
              </div>
            )}

            <UiCardGrid columns={3} className="dashboard-hero-stats">
              <UiCard className="dashboard-mini-card">
                <div className="ui-kicker">Next lock</div>
                <div className="ui-value">
                  {primaryRoundLocked ? "Closed" : primaryRoundCountdown ?? "-"}
                </div>
                <div className="ui-meta">
                  {primaryTipRound ? fmtMelbourneShort(primaryTipRound.lock_time_utc) : "No round"}
                </div>
              </UiCard>
              <UiCard className="dashboard-mini-card">
                <div className="ui-kicker">Unfinished round</div>
                <div className="ui-value">
                  {lockedRoundStillLive && liveRound ? `Round ${liveRound.round_number}` : "None"}
                </div>
                <div className="ui-meta">
                  {lockedRoundStillLive && liveRound
                    ? `${liveRound.completed_matches}/${liveRound.total_matches} games complete`
                    : "No live round right now"}
                </div>
              </UiCard>
              {showUpToDateTile ? (
                <UiCard tone="success" className="dashboard-mini-card">
                  <div className="ui-kicker">Up to date</div>
                  <div className="ui-value">All set</div>
                  <div className="ui-meta">You&apos;re all up to date on your tips.</div>
                </UiCard>
              ) : (
                <UiCard className="dashboard-mini-card">
                  <div className="ui-kicker">Round progress</div>
                  <div className="ui-value">{primaryTipsEntered}/{primaryTipsPossible || 0}</div>
                  <div className="ui-meta">
                    {primaryTipRound
                      ? `${primaryTipsLeft} ${pluralize(primaryTipsLeft, "tip", "tips")} left for Round ${primaryTipRound.round_number}`
                      : "Nothing due"}
                  </div>
                </UiCard>
              )}
            </UiCardGrid>

            {lockedRoundStillLive && liveRound && (
              <div className="dashboard-live-strip">
                <div className="ui-row-between">
                  <div>
                    <div className="ui-kicker">Round in progress</div>
                    <div className="ui-meta">
                      {liveRound.completed_matches}/{liveRound.total_matches} games scored so far
                    </div>
                  </div>
                  <div className="dashboard-live-percent">{liveRoundProgressPct}%</div>
                </div>
                <div className="dashboard-progress">
                  <div
                    className="dashboard-progress-fill"
                    style={{ width: `${liveRoundProgressPct}%` }}
                  />
                </div>
              </div>
            )}

            <div className="dashboard-action-row">
              {primaryTipRound && (
                <UiButtonLink
                  href={`/round/${CURRENT_SEASON}/${primaryTipRound.round_number}`}
                  className="dashboard-primary-link"
                >
                  {primaryRoundLocked ? "View round" : "Continue tipping"}
                </UiButtonLink>
              )}
              {lockedRoundStillLive && liveRound && (
                <UiButtonLink href={`/results/${CURRENT_SEASON}/${liveRound.round_number}`}>
                  Follow live results
                </UiButtonLink>
              )}
              {!lockedRoundStillLive && latestCompletedRound && (
                <UiButtonLink href={`/results/${CURRENT_SEASON}/${latestCompletedRound.round_number}`}>
                  View Round {latestCompletedRound.round_number} results
                </UiButtonLink>
              )}
              <UiButtonLink href={`/leaderboard/${CURRENT_SEASON}`}>View leaderboard</UiButtonLink>
            </div>
          </UiCard>

          {attentionReminders.length > 0 && (
            <UiCard className="dashboard-attention-card">
              <UiSectionHeader
                kicker="Needs attention"
                title={String(attentionReminders.length)}
                subtitle={
                  attentionReminders.length === 1
                    ? "secondary reminder"
                    : `${attentionReminders.length} secondary reminders`
                }
              />

              <div className="dashboard-reminder-list ui-mt-3">
                {attentionReminders.map((item) => (
                  <div key={item.id} className="dashboard-reminder-item">
                    <div className="dashboard-reminder-copy">
                      <div className="dashboard-reminder-title">{item.title}</div>
                      <div className="ui-caption">{item.detail}</div>
                    </div>
                    <UiButtonLink href={item.href} className="dashboard-reminder-cta">
                      {item.cta}
                    </UiButtonLink>
                  </div>
                ))}
              </div>
            </UiCard>
          )}
        </div>
      )}

      {!msg && dashboardNotice && (
        <UiCard tone={dashboardNotice.tone} className="ui-mt-3">
          <div className="ui-kicker">{dashboardNotice.title}</div>
          <div className="ui-stack ui-mt-2">
            {dashboardNotice.lines.map((line) => (
              <div key={line} className="ui-caption">
                {line}
              </div>
            ))}
          </div>
        </UiCard>
      )}

      {!msg && (
        <>
          <UiCard soft className="ui-mt-3">
            <UiSectionHeader
              kicker="Season position"
              title="Your snapshot"
              subtitle="The numbers that matter most right now."
            />
            <UiCardGrid columns={4} className="ui-mt-3">
              <UiCard>
                <div className="ui-kicker">Rank</div>
                <div className="ui-value">{me ? `#${me.rank}` : "-"}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Total points</div>
                <div className="ui-value">{me ? fmtPts(me.total_points) : "-"}</div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Gap to leader</div>
                <div className="ui-value">
                  {me ? (me.behind_leader <= 0 ? "-" : fmtPts(me.behind_leader)) : "-"}
                </div>
              </UiCard>
              <UiCard>
                <div className="ui-kicker">Movement</div>
                <div className="ui-value" style={{ color: movementColor(me?.movement) }}>
                  {me ? movementText(me.movement) : "-"}
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
                <div className="ui-kicker">Payment</div>
                <div className="ui-value">
                  {me?.payment_status ? me.payment_status : "paid"}
                </div>
                <div className="ui-meta">
                  {me?.payment_status === "pending"
                    ? "Needs admin update"
                    : "All clear"}
                </div>
              </UiCard>
            </UiCardGrid>
          </UiCard>

        </>
      )}

    </main>
  );
}
