"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

type MatchMini = {
  round_id: string;
  winner_team: string | null;
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

export default function SeasonResultsPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<RoundRow[]>([]);
  const [msg, setMsg] = useState("Checking session…");
  const [ready, setReady] = useState(false);
  const [statsByRoundId, setStatsByRoundId] = useState<
    Record<string, { total: number; finished: number }>
  >({});

  useEffect(() => {
    let alive = true;

    async function ensureSessionOrRedirect() {
      const { data } = await supabaseBrowser.auth.getSession();
      if (!alive) return;

      if (data.session) {
        setReady(true);
        setMsg("");
        return;
      }

      const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
        if (session) {
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

  useEffect(() => {
    if (!ready) return;

    (async () => {
      setMsg("Loading results rounds…");

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

      const roundRows = (data ?? []) as RoundRow[];
      setRows(roundRows);

      const roundIds = roundRows.map((r) => r.id);
      if (!roundIds.length) {
        setStatsByRoundId({});
        setMsg("");
        return;
      }

      const { data: matchRows, error: mErr } = await supabaseBrowser
        .from("matches")
        .select("round_id, winner_team")
        .in("round_id", roundIds);

      if (mErr) {
        setMsg(`Loaded rounds, but match stats failed: ${mErr.message}`);
        return;
      }

      const stats: Record<string, { total: number; finished: number }> = {};
      for (const rid of roundIds) stats[rid] = { total: 0, finished: 0 };

      (matchRows as MatchMini[] | null)?.forEach((m) => {
        const rid = String(m.round_id);
        if (!stats[rid]) stats[rid] = { total: 0, finished: 0 };
        stats[rid].total += 1;
        if (String(m.winner_team ?? "").trim()) stats[rid].finished += 1;
      });

      setStatsByRoundId(stats);
      setMsg("");
    })();
  }, [ready, season]);

  const hasRows = useMemo(() => rows.length > 0, [rows.length]);
  const [nowMs] = useState<number>(() => Date.now());

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
        <h1 style={{ margin: 0, fontSize: 36, letterSpacing: -0.4 }}>
          Round Results • {season}
        </h1>
        <div style={{ opacity: 0.7, fontSize: 12 }}>All times shown in Melbourne</div>
      </div>

      {msg && <p style={{ marginTop: 14, opacity: 0.8 }}>{msg}</p>}

      {!msg && !hasRows && <div style={{ marginTop: 16, opacity: 0.75 }}>No rounds found.</div>}

      {!msg && hasRows && (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {rows.map((r) => {
            const lock = melbourneMs(r.lock_time_utc);
            const locked = lock ? nowMs >= lock : false;
            const stats = statsByRoundId[r.id] ?? { total: 0, finished: 0 };

            return (
              <Link
                key={r.id}
                href={`/results/${season}/${r.round_number}`}
                style={{
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 18,
                  padding: "14px 14px",
                  textDecoration: "none",
                  color: "var(--foreground)",
                  background: "rgba(255,255,255,0.04)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 68,
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontWeight: 950, fontSize: 18, letterSpacing: -0.2 }}>
                    Round {r.round_number}
                  </div>

                  <div style={{ opacity: 0.75, fontSize: 12 }}>
                    Locked: <span style={{ opacity: 0.95 }}>{fmtMelbourneShort(r.lock_time_utc)}</span>
                  </div>

                  <div style={{ opacity: 0.8, fontSize: 12 }}>
                    Finished matches: <b>{stats.finished}</b>/<b>{stats.total}</b>
                  </div>
                </div>

                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    padding: "8px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background:
                      stats.total > 0 && stats.finished === stats.total
                        ? "rgba(34,197,94,0.12)"
                        : locked
                          ? "rgba(245,158,11,0.12)"
                          : "rgba(59,130,246,0.12)",
                    color:
                      stats.total > 0 && stats.finished === stats.total
                        ? "rgb(34,197,94)"
                        : locked
                          ? "rgb(245,158,11)"
                          : "rgb(59,130,246)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {stats.total > 0 && stats.finished === stats.total
                    ? "COMPLETE"
                    : locked
                      ? "IN PROGRESS"
                      : "NOT STARTED"}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
