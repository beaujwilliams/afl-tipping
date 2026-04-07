"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { waitForSession } from "@/lib/session-client";
import { UiBadge, UiCard, UiSectionHeader, UiSkeleton } from "@/components/ui";

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

type MatchMini = {
  round_id: string;
  winner_team: string | null;
};

type TipStatusRound = {
  round_id: string;
  round_number: number;
  lock_time_utc: string | null;
};

type TipStatusResponse = {
  ok: boolean;
  competition_id: string;
  rounds: TipStatusRound[];
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

function SeasonResultsLoadingSkeleton() {
  return (
    <div className="ui-grid ui-mt-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <UiCard
          key={`results-round-skeleton-${index}`}
          soft
          className="ui-row-between"
          style={{ minHeight: 68, padding: "14px 14px" }}
        >
          <div className="ui-grid" style={{ gap: 6, minWidth: 0, flex: 1 }}>
            <UiSkeleton width={110} height={20} />
            <UiSkeleton width="52%" height={12} />
            <UiSkeleton width="40%" height={12} />
          </div>
          <UiSkeleton width={92} height={28} radius={999} />
        </UiCard>
      ))}
    </div>
  );
}

export default function SeasonResultsPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<RoundRow[]>([]);
  const [msg, setMsg] = useState("Checking session…");
  const [ready, setReady] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [statsByRoundId, setStatsByRoundId] = useState<
    Record<string, { total: number; finished: number }>
  >({});

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
    if (!ready || !sessionToken) return;

    (async () => {
      setMsg("Loading results rounds…");

      const statusRes = await fetch(`/api/round-tip-status?season=${encodeURIComponent(String(season))}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
        cache: "no-store",
      });
      const statusJson = (await statusRes.json().catch(() => null)) as TipStatusResponse | null;

      if (!statusRes.ok || !statusJson?.ok) {
        setMsg(statusJson?.error ?? "Could not load rounds.");
        return;
      }

      const roundRows: RoundRow[] = (statusJson.rounds ?? []).map((r) => ({
        id: r.round_id,
        round_number: r.round_number,
        lock_time_utc: r.lock_time_utc,
      }));
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
  }, [ready, season, sessionToken]);

  const hasRows = useMemo(() => rows.length > 0, [rows.length]);
  const [nowMs] = useState<number>(() => Date.now());
  const visibleRows = useMemo(() => {
    return rows
      .filter((r) => {
        const lock = melbourneMs(r.lock_time_utc);
        return lock ? nowMs >= lock : false;
      })
      .sort((a, b) => b.round_number - a.round_number);
  }, [rows, nowMs]);
  const hiddenCount = rows.length - visibleRows.length;
  const showResultsSkeleton =
    !!msg &&
    (msg.startsWith("Checking") || msg.startsWith("Loading")) &&
    rows.length === 0;

  function roundStatusTone(total: number, finished: number, locked: boolean) {
    if (total > 0 && finished === total) return "success" as const;
    if (locked) return "warning" as const;
    return "info" as const;
  }

  function roundStatusLabel(total: number, finished: number, locked: boolean) {
    if (total > 0 && finished === total) return "COMPLETE";
    if (locked) return "IN PROGRESS";
    return "NOT STARTED";
  }

  return (
    <main className="ui-page ui-page--narrow">
      <UiSectionHeader
        title={`Round Results • ${season}`}
        subtitle="All times shown in Melbourne"
      />

      {showResultsSkeleton && <SeasonResultsLoadingSkeleton />}
      {!!msg && !showResultsSkeleton && <p className="ui-caption ui-mt-4">{msg}</p>}

      {!msg && !hasRows && <div className="ui-caption ui-mt-4">No rounds found.</div>}
      {!msg && hasRows && visibleRows.length === 0 && (
        <div className="ui-caption ui-mt-4">
          No round results are visible yet. Results appear once each round locks.
        </div>
      )}
      {!msg && hiddenCount > 0 && visibleRows.length > 0 && (
        <div className="ui-caption ui-mt-3">
          {hiddenCount} future round{hiddenCount === 1 ? "" : "s"} hidden until lock time.
        </div>
      )}

      {!msg && visibleRows.length > 0 && (
        <div className="ui-grid ui-mt-4">
          {visibleRows.map((r) => {
            const lock = melbourneMs(r.lock_time_utc);
            const locked = lock ? nowMs >= lock : false;
            const stats = statsByRoundId[r.id] ?? { total: 0, finished: 0 };

            return (
              <Link
                key={r.id}
                href={`/results/${season}/${r.round_number}`}
                style={{ WebkitTapHighlightColor: "transparent" }}
              >
                <UiCard soft className="ui-row-between" style={{ minHeight: 68, padding: "14px 14px" }}>
                <div className="ui-grid" style={{ gap: 6 }}>
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

                <UiBadge tone={roundStatusTone(stats.total, stats.finished, locked)}>
                  {roundStatusLabel(stats.total, stats.finished, locked)}
                </UiBadge>
                </UiCard>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
