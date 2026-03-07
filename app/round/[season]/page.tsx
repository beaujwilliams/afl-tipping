"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UnpaidTag } from "@/components/UnpaidTag";

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

type MissingPlayer = {
  user_id: string;
  display_name: string | null;
  payment_status?: string | null;
};

type TipStatusRound = {
  round_id: string;
  round_number: number;
  lock_time_utc: string | null;
  total_players: number;
  tipped_players: number;
  missing_count: number;
  missing_players?: MissingPlayer[];
};

type TipStatusResponse = {
  ok: boolean;
  season: number;
  competition_id: string;
  admin: boolean;
  rounds: TipStatusRound[];
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

function shortId(id: string) {
  return `${id.slice(0, 8)}…`;
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

  // per-round expand/collapse for "who hasn't tipped"
  const [openRoundId, setOpenRoundId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function ensureSessionOrRedirect() {
      const { data } = await supabaseBrowser.auth.getSession();
      if (!alive) return;

      if (data.session) {
        setSessionToken(data.session.access_token);
        setReady(true);
        setMsg("");
        return;
      }

      const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
        if (session) {
          setSessionToken(session.access_token);
          setReady(true);
          setMsg("");
          sub.subscription.unsubscribe();
        }
      });

      setTimeout(async () => {
        const { data: again } = await supabaseBrowser.auth.getSession();
        if (!alive) return;

        if (!again.session) window.location.href = "/login";
        else {
          setSessionToken(again.session.access_token);
          setReady(true);
          setMsg("");
        }
        sub.subscription.unsubscribe();
      }, 1200);
    }

    ensureSessionOrRedirect();

    return () => {
      alive = false;
    };
  }, []);

  // Load rounds
  useEffect(() => {
    if (!ready) return;

    (async () => {
      setMsg("Loading rounds…");

      const { data: comp } = await supabaseBrowser.from("competitions").select("id").limit(1).single();

      if (!comp) {
        setMsg("No competition found.");
        return;
      }

      const { data, error } = await supabaseBrowser
        .from("rounds")
        .select("id, round_number, lock_time_utc")
        .eq("competition_id", comp.id)
        .eq("season", season)
        .order("round_number", { ascending: true });

      if (error) {
        setMsg(error.message);
        return;
      }

      setRows((data ?? []) as RoundRow[]);
      setMsg("");
    })();
  }, [ready, season]);

  // Load tip status (counts + admin missing list)
  useEffect(() => {
    if (!ready || !sessionToken) return;

    (async () => {
      try {
        const res = await fetch(`/api/round-tip-status?season=${encodeURIComponent(String(season))}`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
          cache: "no-store",
        });

        const json = (await res.json().catch(() => null)) as TipStatusResponse | null;

        if (!res.ok || !json?.ok) {
          // Don’t block the page if this fails
          return;
        }

        setIsAdmin(!!json.admin);

        const map: Record<string, TipStatusRound> = {};
        (json.rounds ?? []).forEach((r) => {
          map[r.round_id] = r;
        });
        setStatusByRoundId(map);
      } catch {
        // ignore
      }
    })();
  }, [ready, sessionToken, season]);

  const hasRows = useMemo(() => rows.length > 0, [rows.length]);
  const nowMs = Date.now();

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
        <h1 style={{ margin: 0, fontSize: 40, letterSpacing: -0.5 }}>Rounds • {season}</h1>
        <div style={{ opacity: 0.7, fontSize: 12 }}>All times shown in Melbourne</div>
      </div>

      {msg && <p style={{ marginTop: 14, opacity: 0.8 }}>{msg}</p>}

      {!msg && !hasRows && <div style={{ marginTop: 16, opacity: 0.75 }}>No rounds found.</div>}

      {!msg && hasRows && (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {rows.map((r) => {
            const lock = melbourneMs(r.lock_time_utc);
            const locked = lock ? nowMs >= lock : false;

            const status = statusByRoundId[r.id];
            const total = status?.total_players ?? null;
            const tipped = status?.tipped_players ?? null;
            const missingCount = status?.missing_count ?? null;

            const isOpen = openRoundId === r.id;

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
                          Tipped{" "}
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
                          setOpenRoundId((prev) => (prev === r.id ? null : r.id));
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
                        {isOpen ? "Hide" : "Who hasn’t tipped?"}
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
                    <div style={{ fontWeight: 900, marginBottom: 8, opacity: 0.95 }}>
                      Still to tip ({status.missing_players.length})
                    </div>

                    {status.missing_players.length === 0 ? (
                      <div style={{ opacity: 0.7, fontSize: 13 }}>Everyone has tipped 🎉</div>
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        {status.missing_players.map((p) => (
                          <div
                            key={p.user_id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              alignItems: "center",
                              padding: "10px 12px",
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.03)",
                            }}
                          >
                            <div style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span>{p.display_name?.trim() ? p.display_name : "(no display name)"}</span>
                              <UnpaidTag paymentStatus={p.payment_status ?? null} />
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.65 }}>{shortId(p.user_id)}</div>
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
      )}
    </main>
  );
}
