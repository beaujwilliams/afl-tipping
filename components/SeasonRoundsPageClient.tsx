"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { UnpaidTag } from "@/components/UnpaidTag";
import { ChampionCrown } from "@/components/ChampionCrown";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiButtonLink, UiCard } from "@/components/ui";

export type SeasonRoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

type RoundStatusPlayer = {
  user_id: string;
  display_name: string | null;
  payment_status?: string | null;
  tips_entered?: number;
};

export type SeasonTipStatusRound = {
  round_id: string;
  round_number: number;
  lock_time_utc: string | null;
  total_matches: number;
  completed_matches: number;
  round_complete: boolean;
  my_tips: number;
  total_players: number;
  tipped_players: number;
  missing_count: number;
  missing_players?: RoundStatusPlayer[];
  tipped_players_list?: RoundStatusPlayer[];
};

type ReminderRoundResult = {
  round: number;
  missing_tip_members: number;
  already_reminded: number;
  candidates: number;
  no_email: number;
  sent: number;
  simulated: number;
  failed: number;
};

type ReminderApiResponse = {
  ok?: boolean;
  error?: string;
  results?: ReminderRoundResult[];
  errors?: Array<{ round: number; error: string }>;
  totals?: {
    sent?: number;
    simulated?: number;
    failed?: number;
    no_email?: number;
  };
};

type SeasonRoundsPageClientProps = {
  season: number;
  rows: SeasonRoundRow[];
  statusByRoundId: Record<string, SeasonTipStatusRound>;
  isAdmin: boolean;
  reigningChampionUserId: string | null;
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

export default function SeasonRoundsPageClient({
  season,
  rows,
  statusByRoundId,
  isAdmin,
  reigningChampionUserId,
  initialMessage,
}: SeasonRoundsPageClientProps) {
  const msg = initialMessage ?? "";

  // per-round expand/collapse for "who hasn't tipped"
  const [openRoundId, setOpenRoundId] = useState<string | null>(null);
  const [openRoundTabById, setOpenRoundTabById] = useState<
    Record<string, "missing" | "tipped">
  >({});
  const [tipListSearchByRoundId, setTipListSearchByRoundId] = useState<Record<string, string>>(
    {}
  );
  const [reminderRunningRoundId, setReminderRunningRoundId] = useState<string | null>(null);
  const [reminderStatusByRoundId, setReminderStatusByRoundId] = useState<Record<string, string>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  function setRoundReminderStatus(roundId: string, text: string) {
    setReminderStatusByRoundId((prev) => ({ ...prev, [roundId]: text }));
  }

  async function sendRoundReminders(roundId: string, roundNumber: number) {
    const { data } = await supabaseBrowser.auth.getSession();
    const sessionToken = data.session?.access_token ?? null;
    if (!sessionToken) {
      setRoundReminderStatus(roundId, "Not authenticated.");
      return;
    }

    const ok = confirm(`Send reminder emails now for Round ${roundNumber}?`);
    if (!ok) return;

    setReminderRunningRoundId(roundId);
    setRoundReminderStatus(roundId, "Sending reminders…");

    try {
      const res = await fetch(
        `/api/admin/send-prelock-reminders?season=${encodeURIComponent(String(season))}&round=${encodeURIComponent(
          String(roundNumber)
        )}&force=1`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
          cache: "no-store",
        }
      );

      const json = (await res.json().catch(() => null)) as ReminderApiResponse | null;

      if (!res.ok || !json) {
        setRoundReminderStatus(roundId, json?.error ?? "Reminder request failed.");
        return;
      }

      const row = (json.results ?? []).find((x) => Number(x.round) === roundNumber) ?? null;
      const roundError =
        (json.errors ?? []).find((x) => Number(x.round) === roundNumber)?.error ??
        json.error ??
        "";

      if (roundError) {
        setRoundReminderStatus(roundId, `Error: ${roundError}`);
        return;
      }

      if (!row) {
        setRoundReminderStatus(roundId, "No reminder result returned for this round.");
        return;
      }

      setRoundReminderStatus(
        roundId,
        `Sent ${row.sent}. Already reminded ${row.already_reminded}. No email ${row.no_email}. Failed ${row.failed}.`
      );
    } catch {
      setRoundReminderStatus(roundId, "Reminder request failed.");
    } finally {
      setReminderRunningRoundId(null);
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const hasRows = useMemo(() => rows.length > 0, [rows.length]);

  const currentRound = useMemo(() => {
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => a.round_number - b.round_number);

    const inProgress = [...sorted].reverse().find((r) => {
      const lock = melbourneMs(r.lock_time_utc);
      const s = statusByRoundId[r.id];
      if (lock === null || nowMs < lock || !s) return false;

      const totalMatches = Number(s.total_matches ?? 0);
      if (totalMatches <= 0) return false;

      const roundComplete =
        Boolean(s.round_complete) ||
        Number(s.completed_matches ?? 0) >= totalMatches;

      return !roundComplete;
    });
    if (inProgress) return inProgress;

    const nextOpen = sorted.find((r) => {
      const lock = melbourneMs(r.lock_time_utc);
      return lock !== null && nowMs < lock;
    });
    return nextOpen ?? sorted[sorted.length - 1];
  }, [rows, nowMs, statusByRoundId]);

  const currentRoundStatus = currentRound ? statusByRoundId[currentRound.id] : null;
  const currentRoundLockMs = currentRound ? melbourneMs(currentRound.lock_time_utc) : null;
  const currentRoundLocked = currentRoundLockMs ? nowMs >= currentRoundLockMs : false;
  const currentRoundCountdown =
    currentRoundLockMs && !currentRoundLocked ? msToCountdown(currentRoundLockMs - nowMs) : null;
  const currentRoundTipsPlaced = currentRoundStatus?.my_tips ?? 0;
  const currentRoundTipsPossible = currentRoundStatus?.total_matches ?? 0;

  return (
    <main className="ui-page ui-page--narrow">
      <div className="ui-page-header">
        <h1 className="ui-title">Tip</h1>
        <div className="ui-caption">All times shown in Melbourne</div>
      </div>

      {msg && <p className="ui-caption ui-mt-4">{msg}</p>}

      {!msg && !hasRows && <div className="ui-caption ui-mt-4">No tip rounds found.</div>}

      {!msg && hasRows && currentRound && (
        <UiCard soft className="ui-row-between ui-mt-4">
          <div className="ui-grid" style={{ gap: 6 }}>
            <div className="ui-title--section">Current round: Round {currentRound.round_number}</div>
            <div className="ui-meta">
              {currentRoundLocked
                ? `Locked ${fmtMelbourneShort(currentRound.lock_time_utc)}`
                : `Locks in ${currentRoundCountdown} (${fmtMelbourneShort(currentRound.lock_time_utc)})`}
            </div>
            <div className="ui-meta">
              Your tips:{" "}
              <b>
                {currentRoundTipsPlaced}/{currentRoundTipsPossible || "—"}
              </b>
            </div>
          </div>

          <UiButtonLink
            href={`/round/${season}/${currentRound.round_number}`}
            style={{ padding: "10px 14px" }}
          >
            {currentRoundLocked ? "View round" : "Continue tipping"}
          </UiButtonLink>
        </UiCard>
      )}

      {!msg && hasRows && (
        <div className="ui-mt-5">
          <div className="ui-divider-top" style={{ marginBottom: 12 }}>
            <div style={{ opacity: 0.62, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" }}>
              {season} Season
            </div>
            <div style={{ marginTop: 4, fontWeight: 900, fontSize: 18, letterSpacing: -0.2 }}>
              Season rounds
            </div>
          </div>

          <div className="ui-grid">
          {rows.map((r) => {
            const lock = melbourneMs(r.lock_time_utc);
            const locked = lock ? nowMs >= lock : false;

            const status = statusByRoundId[r.id];
            const total = status?.total_players ?? null;
            const tipped = status?.tipped_players ?? null;
            const missingCount = status?.missing_count ?? null;
            const missingPlayers = status?.missing_players ?? [];
            const tippedPlayers = status?.tipped_players_list ?? [];

            const isOpen = openRoundId === r.id;
            const openTab = openRoundTabById[r.id] ?? "missing";
            const activeList = openTab === "missing" ? missingPlayers : tippedPlayers;
            const search = tipListSearchByRoundId[r.id] ?? "";
            const q = search.trim().toLowerCase();
            const filteredActiveList = q
              ? activeList.filter((p) => {
                  const name = String(p.display_name ?? "").toLowerCase();
                  const id = String(p.user_id).toLowerCase();
                  return name.includes(q) || id.includes(q);
                })
              : activeList;

            return (
              <div key={r.id}>
                <Link
                  href={`/round/${season}/${r.round_number}`}
                  className="ui-card ui-card-soft"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 14,
                    minHeight: 64,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontWeight: 950, fontSize: 18, letterSpacing: -0.2 }}>
                      Round {r.round_number}
                    </div>

                    <div style={{ opacity: 0.75, fontSize: 12 }}>
                      Locks: <span style={{ opacity: 0.95 }}>{fmtMelbourneShort(r.lock_time_utc)}</span>
                    </div>

                    {/* Tip status line */}
                    <div style={{ opacity: 0.8, fontSize: 12 }}>
                      {total === null || tipped === null ? (
                        <span style={{ opacity: 0.65 }}>Tip status loading…</span>
                      ) : (
                        <>
                          Fully tipped{" "}
                          <b style={{ opacity: 0.95 }}>
                            {tipped}/{total}
                          </b>
                          {typeof missingCount === "number" && missingCount > 0 ? (
                            <span style={{ marginLeft: 10, opacity: 0.75 }}>
                              ({missingCount} to go)
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className={`ui-badge ${locked ? "ui-badge--locked" : "ui-badge--open"}`}>
                      {locked ? "LOCKED" : "OPEN"}
                    </div>

                    {/* Admin toggle button (does NOT navigate) */}
                    {isAdmin && status?.missing_players && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const nextOpen = openRoundId === r.id ? null : r.id;
                          setOpenRoundId(nextOpen);
                          if (nextOpen === r.id) {
                            setOpenRoundTabById((prev) => ({
                              ...prev,
                              [r.id]: prev[r.id] ?? "missing",
                            }));
                            setTipListSearchByRoundId((prev) => ({
                              ...prev,
                              [r.id]: prev[r.id] ?? "",
                            }));
                          }
                        }}
                        className="ui-btn ui-btn--pill"
                      >
                        {isOpen ? "Hide lists" : "Tip lists"}
                      </button>
                    )}
                  </div>
                </Link>

                {/* Admin expandable list */}
                {isAdmin && isOpen && status?.missing_players && (
                  <div className="ui-card ui-card-soft" style={{ marginTop: 10 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ fontWeight: 900, opacity: 0.95 }}>
                        Round {r.round_number} tip lists
                      </div>
                    </div>

                    <div className="ui-row-wrap" style={{ marginBottom: 10 }}>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenRoundTabById((prev) => ({ ...prev, [r.id]: "missing" }))
                        }
                        className={`ui-btn ui-btn--pill ${
                          openTab === "missing" ? "ui-btn--active-danger" : ""
                        }`}
                      >
                        Not tipped ({missingPlayers.length})
                      </button>

                      <button
                        type="button"
                        className={`ui-btn ui-btn--pill ${
                          openTab === "tipped" ? "ui-btn--active-success" : ""
                        }`}
                        onClick={() =>
                          setOpenRoundTabById((prev) => ({ ...prev, [r.id]: "tipped" }))
                        }
                      >
                        Tipped ({tippedPlayers.length})
                      </button>
                    </div>

                    <div className="ui-row-wrap" style={{ marginBottom: 10 }}>
                      <input
                        value={search}
                        onChange={(e) =>
                          setTipListSearchByRoundId((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        placeholder={`Search ${openTab === "missing" ? "not tipped" : "tipped"} members...`}
                        className="ui-input"
                      />

                      {openTab === "missing" && (
                        <button
                          type="button"
                          onClick={() => sendRoundReminders(r.id, r.round_number)}
                          disabled={reminderRunningRoundId === r.id || missingPlayers.length === 0}
                          className="ui-btn ui-btn--pill ui-btn--danger-soft"
                        >
                          {reminderRunningRoundId === r.id ? "Sending…" : "Send reminders now"}
                        </button>
                      )}
                    </div>

                    {reminderStatusByRoundId[r.id] && (
                      <div style={{ marginBottom: 10, fontSize: 12, opacity: 0.8 }}>
                        {reminderStatusByRoundId[r.id]}
                      </div>
                    )}

                    {filteredActiveList.length === 0 ? (
                      <div style={{ opacity: 0.7, fontSize: 13 }}>
                        {q
                          ? "No members match your search."
                          : openTab === "missing"
                            ? "Everyone has tipped all games."
                            : "No fully tipped members yet."}
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 8, maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
                        {filteredActiveList.map((p) => (
                          <div
                            key={p.user_id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              alignItems: "center",
                              padding: "8px 10px",
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.03)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 16,
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                flexWrap: "wrap",
                              }}
                            >
                              <ChampionCrown isChampion={p.user_id === reigningChampionUserId} />
                              <span>{p.display_name?.trim() ? p.display_name : "(no display name)"}</span>
                              <UnpaidTag paymentStatus={p.payment_status ?? null} />
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.75, whiteSpace: "nowrap" }}>
                              Tips entered{" "}
                              <b>
                                {Math.min(p.tips_entered ?? 0, status?.total_matches ?? 0)}/
                                {status?.total_matches ?? 0}
                              </b>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}
    </main>
  );
}
