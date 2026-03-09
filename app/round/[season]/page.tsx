"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { UnpaidTag } from "@/components/UnpaidTag";
import { ChampionCrown } from "@/components/ChampionCrown";
import { waitForSession } from "@/lib/session-client";

type RoundRow = {
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

type TipStatusRound = {
  round_id: string;
  round_number: number;
  lock_time_utc: string | null;
  total_matches: number;
  my_tips: number;
  total_players: number;
  tipped_players: number;
  missing_count: number;
  missing_players?: RoundStatusPlayer[];
  tipped_players_list?: RoundStatusPlayer[];
};

type TipStatusResponse = {
  ok: boolean;
  season: number;
  competition_id: string;
  reigning_champion_user_id?: string | null;
  admin: boolean;
  rounds: TipStatusRound[];
  error?: string;
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

export default function SeasonRoundsPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<RoundRow[]>([]);
  const [msg, setMsg] = useState("Checking session…");
  const [ready, setReady] = useState(false);

  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // tip-status payload
  const [statusByRoundId, setStatusByRoundId] = useState<Record<string, TipStatusRound>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [reigningChampionUserId, setReigningChampionUserId] = useState<string | null>(null);

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
    let alive = true;

    async function ensureSessionOrRedirect() {
      const session = await waitForSession(3000, 180);
      if (!alive) return;

      if (!session) {
        window.location.href = "/login";
        return;
      }

      setSessionToken(session.access_token);
      setReady(true);
      setMsg("");
    }

    ensureSessionOrRedirect();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Load rounds
  // Load rounds + tip status (counts + admin missing list)
  useEffect(() => {
    if (!ready || !sessionToken) return;

    (async () => {
      setMsg("Loading tip rounds…");
      setReigningChampionUserId(null);
      try {
        const res = await fetch(`/api/round-tip-status?season=${encodeURIComponent(String(season))}`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
          cache: "no-store",
        });

        const json = (await res.json().catch(() => null)) as TipStatusResponse | null;

        if (!res.ok || !json?.ok) {
          // Don’t block the page if this fails
          setMsg(json?.error ?? "Could not load tip rounds.");
          return;
        }

        setIsAdmin(!!json.admin);
        setReigningChampionUserId(
          typeof json.reigning_champion_user_id === "string" ? json.reigning_champion_user_id : null
        );
        setRows(
          (json.rounds ?? []).map((r) => ({
            id: r.round_id,
            round_number: r.round_number,
            lock_time_utc: r.lock_time_utc,
          }))
        );

        const map: Record<string, TipStatusRound> = {};
        (json.rounds ?? []).forEach((r) => {
          map[r.round_id] = r;
        });
        setStatusByRoundId(map);
        setMsg("");
      } catch {
        setMsg("Could not load tip rounds.");
      }
    })();
  }, [ready, sessionToken, season]);

  const hasRows = useMemo(() => rows.length > 0, [rows.length]);

  const currentRound = useMemo(() => {
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => a.round_number - b.round_number);
    const nextOpen = sorted.find((r) => {
      const lock = melbourneMs(r.lock_time_utc);
      return lock !== null && nowMs < lock;
    });
    return nextOpen ?? sorted[sorted.length - 1];
  }, [rows, nowMs]);

  const currentRoundStatus = currentRound ? statusByRoundId[currentRound.id] : null;
  const currentRoundLockMs = currentRound ? melbourneMs(currentRound.lock_time_utc) : null;
  const currentRoundLocked = currentRoundLockMs ? nowMs >= currentRoundLockMs : false;
  const currentRoundCountdown =
    currentRoundLockMs && !currentRoundLocked ? msToCountdown(currentRoundLockMs - nowMs) : null;
  const currentRoundTipsPlaced = currentRoundStatus?.my_tips ?? 0;
  const currentRoundTipsPossible = currentRoundStatus?.total_matches ?? 0;

  return (
    <main style={{ maxWidth: 900, margin: "26px auto", padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 40, letterSpacing: -0.5 }}>Tip</h1>
        <div style={{ opacity: 0.7, fontSize: 12 }}>All times shown in Melbourne</div>
      </div>

      {msg && <p style={{ marginTop: 14, opacity: 0.8 }}>{msg}</p>}

      {!msg && !hasRows && <div style={{ marginTop: 16, opacity: 0.75 }}>No tip rounds found.</div>}

      {!msg && hasRows && currentRound && (
        <div
          style={{
            marginTop: 16,
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 14,
            background: "var(--card-soft)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 900, fontSize: 17 }}>Current round: Round {currentRound.round_number}</div>
            <div style={{ fontSize: 13, opacity: 0.78 }}>
              {currentRoundLocked
                ? `Locked ${fmtMelbourneShort(currentRound.lock_time_utc)}`
                : `Locks in ${currentRoundCountdown} (${fmtMelbourneShort(currentRound.lock_time_utc)})`}
            </div>
            <div style={{ fontSize: 13, opacity: 0.86 }}>
              Your tips:{" "}
              <b>
                {currentRoundTipsPlaced}/{currentRoundTipsPossible || "—"}
              </b>
            </div>
          </div>

          <Link
            href={`/round/${season}/${currentRound.round_number}`}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--foreground)",
              fontWeight: 900,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {currentRoundLocked ? "View round" : "Continue tipping"}
          </Link>
        </div>
      )}

      {!msg && hasRows && (
        <div style={{ marginTop: 22 }}>
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ opacity: 0.62, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" }}>
              {season} Season
            </div>
            <div style={{ marginTop: 4, fontWeight: 900, fontSize: 18, letterSpacing: -0.2 }}>
              Season rounds
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
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
                  style={{
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 18,
                    padding: "16px 16px",
                    textDecoration: "none",
                    color: "var(--foreground)",
                    background: "rgba(255,255,255,0.04)",
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
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 900,
                        padding: "8px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.16)",
                        background: locked ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
                        color: locked ? "rgb(239,68,68)" : "rgb(34,197,94)",
                        whiteSpace: "nowrap",
                      }}
                    >
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
                        style={{
                          padding: "8px 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.16)",
                          background: "rgba(255,255,255,0.06)",
                          color: "var(--foreground)",
                          fontWeight: 900,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isOpen ? "Hide lists" : "Tip lists"}
                      </button>
                    )}
                  </div>
                </Link>

                {/* Admin expandable list */}
                {isAdmin && isOpen && status?.missing_players && (
                  <div
                    style={{
                      marginTop: 10,
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 16,
                      padding: 14,
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
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

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 10,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenRoundTabById((prev) => ({ ...prev, [r.id]: "missing" }))
                        }
                        style={{
                          padding: "7px 11px",
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.16)",
                          background:
                            openTab === "missing"
                              ? "rgba(239,68,68,0.16)"
                              : "rgba(255,255,255,0.06)",
                          color: "var(--foreground)",
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                      >
                        Not tipped ({missingPlayers.length})
                      </button>

                      <button
                        type="button"
                        style={{
                          padding: "7px 11px",
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.16)",
                          background:
                            openTab === "tipped"
                              ? "rgba(34,197,94,0.16)"
                              : "rgba(255,255,255,0.06)",
                          color: "var(--foreground)",
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          setOpenRoundTabById((prev) => ({ ...prev, [r.id]: "tipped" }))
                        }
                      >
                        Tipped ({tippedPlayers.length})
                      </button>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 10,
                      }}
                    >
                      <input
                        value={search}
                        onChange={(e) =>
                          setTipListSearchByRoundId((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        placeholder={`Search ${openTab === "missing" ? "not tipped" : "tipped"} members...`}
                        style={{
                          flex: "1 1 240px",
                          minWidth: 180,
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.16)",
                          background: "rgba(255,255,255,0.04)",
                          color: "var(--foreground)",
                        }}
                      />

                      {openTab === "missing" && (
                        <button
                          type="button"
                          onClick={() => sendRoundReminders(r.id, r.round_number)}
                          disabled={reminderRunningRoundId === r.id || missingPlayers.length === 0}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.16)",
                            background:
                              reminderRunningRoundId === r.id
                                ? "rgba(255,255,255,0.06)"
                                : "rgba(239,68,68,0.14)",
                            color: "var(--foreground)",
                            fontWeight: 900,
                            cursor:
                              reminderRunningRoundId === r.id || missingPlayers.length === 0
                                ? "not-allowed"
                                : "pointer",
                            opacity: missingPlayers.length === 0 ? 0.6 : 1,
                          }}
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
