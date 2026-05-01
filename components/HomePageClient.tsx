"use client";

import { useEffect, useMemo, useState } from "react";
import { useChatActivity } from "@/components/ChatActivityProvider";
import { UiBadge, UiButtonLink, UiCard, UiCardGrid, UiSectionHeader } from "@/components/ui";
import { isMatchCompleted } from "@/lib/match-status";
import { getRoundDisplayName } from "@/lib/round-label";

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
  round_score: number;
  movement: number;
  behind_leader: number;
  payment_status?: string | null;
};

export type HomeTodayPickRow = {
  match_id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  picked_team: string | null;
  winner_team: string | null;
  status: string | null;
};

export type HomeFirstMatchRow = {
  round_id: string;
  match_id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
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
  todayPicks?: HomeTodayPickRow[];
  firstMatches?: HomeFirstMatchRow[];
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

function fmtMelbourneLockLine(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const weekday = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
  }).format(d);
  const dayMonth = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    day: "2-digit",
    month: "short",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toLowerCase();

  return `${weekday}, ${dayMonth} at ${time}`;
}

function fmtMelbourneTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toLowerCase();
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
  return "-";
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
  todayPicks = [],
  firstMatches = [],
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
  const actionStatusLabel = liveRound ? "In progress" : locked ? "Locked" : "Open";
  const actionStatusTone = liveRound ? "info" : locked ? "locked" : "open";
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
  const liveRoundHasScoredMatches = Number(liveRound?.completed_matches ?? 0) > 0;
  const liveRoundScore = liveRoundHasScoredMatches ? Number(me?.round_score ?? 0) : 0;

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
  const liveModeNextLockRound = nextOpenRound ?? primaryTipRound;
  const liveModeNextLockLine = fmtMelbourneLockLine(liveModeNextLockRound?.lock_time_utc ?? null);

  const firstMatchByRoundId = useMemo(() => {
    return new Map(firstMatches.map((match) => [String(match.round_id), match]));
  }, [firstMatches]);

  const primaryFirstMatch = primaryTipRound
    ? firstMatchByRoundId.get(String(primaryTipRound.round_id))
    : null;

  const primaryStatusValue =
    primaryTipRound && primaryRoundLocked
      ? "Locked"
      : primaryTipRound && primaryTipsLeft > 0
      ? "Needs tips"
      : primaryTipRound
      ? "All set"
      : "No round";

  const primaryStatusDetail =
    primaryTipRound && primaryRoundLocked
      ? `Tips are closed for ${getRoundDisplayName(primaryTipRound.round_number)}.`
      : primaryTipRound && primaryTipsLeft > 0
      ? `${primaryTipsLeft} ${pluralize(primaryTipsLeft, "tip", "tips")} left for ${getRoundDisplayName(
          primaryTipRound.round_number
        )}.`
      : primaryTipRound
      ? "You're up to date on your tips."
      : "Nothing due right now.";

  const reminders = useMemo(() => {
    const items: DashboardReminder[] = [];

    if (primaryTipRound && !primaryRoundLocked && primaryTipsLeft > 0) {
      items.push({
        id: "missing-tips",
        title: `Finish ${getRoundDisplayName(primaryTipRound.round_number)}`,
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

  const sortedTodayPicks = useMemo(() => {
    return [...todayPicks].sort((a, b) => {
      return new Date(a.commence_time_utc).getTime() - new Date(b.commence_time_utc).getTime();
    });
  }, [todayPicks]);

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
              <UiBadge tone={actionStatusTone}>{actionStatusLabel}</UiBadge>
            </div>

            <div className="dashboard-hero-title">
              {liveRound
                ? `${getRoundDisplayName(liveRound.round_number)} is live`
                : primaryTipRound && !primaryRoundLocked
                ? `${getRoundDisplayName(primaryTipRound.round_number)} closes in ${primaryRoundCountdown}.`
                : primaryTipRound
                ? `${getRoundDisplayName(primaryTipRound.round_number)} is locked.`
                : "No round loaded."}
            </div>

            {liveRound && (
              <div className="dashboard-hero-meta">
                {liveModeNextLockLine
                  ? `Next tips lock: ${liveModeNextLockLine} (Melbourne)`
                  : "Next tips lock: TBC (Melbourne)"}
              </div>
            )}
            {!liveRound && primaryTipRound && (
              <div className="dashboard-hero-meta">
                {primaryRoundLocked
                  ? `Locked ${fmtMelbourneShort(primaryTipRound.lock_time_utc)}`
                  : `${fmtMelbourneShort(primaryTipRound.lock_time_utc)} in Melbourne time`}
              </div>
            )}

            <UiCardGrid columns={3} className="dashboard-hero-stats">
              {lockedRoundStillLive && liveRound ? (
                <>
                  <UiCard className="dashboard-mini-card">
                    <div className="ui-kicker">Round progress</div>
                    <div className="ui-value">
                      {liveRound.completed_matches}/{liveRound.total_matches}
                    </div>
                    <div className="ui-meta">{liveRoundProgressPct}% games scored</div>
                  </UiCard>
                  <UiCard className="dashboard-mini-card">
                    <div className="ui-kicker">Your round score</div>
                    <div className="ui-value">{me ? fmtPts(liveRoundScore) : "-"}</div>
                    <div className="ui-meta">
                      {liveRoundHasScoredMatches
                        ? `Live ${getRoundDisplayName(liveRound.round_number)} points so far`
                        : "Waiting for first result"}
                    </div>
                  </UiCard>
                  <UiCard className="dashboard-mini-card">
                    <div className="ui-kicker">Live ladder</div>
                    <div className="ui-value">{me ? `#${me.rank}` : "-"}</div>
                    <div className="ui-meta">
                      {me
                        ? `${movementText(me.movement)} • ${
                            me.behind_leader <= 0
                              ? "Leader right now"
                              : `${fmtPts(me.behind_leader)} behind leader`
                          }`
                        : "Waiting for latest ladder"}
                    </div>
                  </UiCard>
                </>
              ) : (
                <>
                  <UiCard className="dashboard-mini-card">
                    <div className="ui-kicker">Your tips</div>
                    <div className="ui-value">{primaryTipsEntered}/{primaryTipsPossible || 0}</div>
                    <div className="ui-meta">
                      {primaryTipRound
                        ? primaryTipsLeft === 0
                          ? "0 left to tip"
                          : `${primaryTipsLeft} ${pluralize(primaryTipsLeft, "tip", "tips")} left to tip`
                        : "Nothing due"}
                    </div>
                  </UiCard>
                  <UiCard className="dashboard-mini-card">
                    <div className="ui-kicker">First match</div>
                    <div className="dashboard-match-value">
                      {primaryFirstMatch
                        ? `${primaryFirstMatch.home_team} vs ${primaryFirstMatch.away_team}`
                        : "Not scheduled"}
                    </div>
                    <div className="ui-meta">
                      {primaryFirstMatch
                        ? fmtMelbourneLockLine(primaryFirstMatch.commence_time_utc)
                        : "Fixture not loaded yet"}
                    </div>
                  </UiCard>
                  {showUpToDateTile ? (
                    <UiCard tone="success" className="dashboard-mini-card">
                      <div className="ui-kicker">Status</div>
                      <div className="ui-value">{primaryStatusValue}</div>
                      <div className="ui-meta">{primaryStatusDetail}</div>
                    </UiCard>
                  ) : (
                    <UiCard
                      tone={primaryTipRound && !primaryRoundLocked && primaryTipsLeft > 0 ? "warning" : "default"}
                      className="dashboard-mini-card"
                    >
                      <div className="ui-kicker">Status</div>
                      <div className="ui-value">{primaryStatusValue}</div>
                      <div className="ui-meta">{primaryStatusDetail}</div>
                    </UiCard>
                  )}
                </>
              )}
            </UiCardGrid>

            <div className="dashboard-today-picks">
              <div className="ui-kicker">Who you tipped today</div>
              {sortedTodayPicks.length === 0 ? (
                <div className="ui-meta dashboard-today-empty">No matches scheduled today.</div>
              ) : (
                <div className="dashboard-today-list">
                  {sortedTodayPicks.map((pick) => {
                    const pickedTeam = String(pick.picked_team ?? "").trim();
                    const winnerTeam = String(pick.winner_team ?? "").trim();
                    const completed = isMatchCompleted(pick);
                    const opponent =
                      pickedTeam === pick.home_team
                        ? pick.away_team
                        : pickedTeam === pick.away_team
                        ? pick.home_team
                        : `${pick.home_team} vs ${pick.away_team}`;

                    let tone: "warning" | "info" | "success" | "danger" = "warning";
                    let statusLabel = "Not tipped";
                    if (pickedTeam) {
                      if (!completed) {
                        tone = "info";
                        statusLabel = "Pending";
                      } else if (pickedTeam === winnerTeam) {
                        tone = "success";
                        statusLabel = "Correct";
                      } else {
                        tone = "danger";
                        statusLabel = "Incorrect";
                      }
                    }

                    return (
                      <div key={pick.match_id} className="dashboard-today-item">
                        <div className="dashboard-today-copy">
                          <div className="dashboard-today-picked">
                            {pickedTeam || `${pick.home_team} vs ${pick.away_team}`}
                          </div>
                          <div className="ui-meta">
                            {pickedTeam
                              ? `vs ${opponent} • ${fmtMelbourneTime(pick.commence_time_utc)}`
                              : `${fmtMelbourneTime(pick.commence_time_utc)} • Tip not saved`}
                          </div>
                        </div>
                        <UiBadge tone={tone}>{statusLabel}</UiBadge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="dashboard-action-row">
              {primaryTipRound && !lockedRoundStillLive && (
                <UiButtonLink
                  href={`/round/${CURRENT_SEASON}/${primaryTipRound.round_number}`}
                  className="dashboard-primary-link"
                >
                  {primaryRoundLocked ? "View round" : "Continue tipping"}
                </UiButtonLink>
              )}
              {lockedRoundStillLive && liveRound && (
                <UiButtonLink href={`/results/${CURRENT_SEASON}/${liveRound.round_number}`}>
                  Follow round results
                </UiButtonLink>
              )}
              {!lockedRoundStillLive && latestCompletedRound && (
                <UiButtonLink href={`/results/${CURRENT_SEASON}/${latestCompletedRound.round_number}`}>
                  View {getRoundDisplayName(latestCompletedRound.round_number)} results
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

      {!msg && (
        <>
          <UiCard soft className="ui-mt-3">
            <UiSectionHeader
              kicker="Season position"
              title="Your snapshot"
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
            </UiCardGrid>
          </UiCard>

        </>
      )}

    </main>
  );
}
