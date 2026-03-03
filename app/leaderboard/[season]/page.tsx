"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type RoundRow = {
  id: string;
  season: number;
  round_number: number;
  lock_time_utc: string;
};

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

export default function SeasonRoundsPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [msg, setMsg] = useState("Loading…");

  useEffect(() => {
    (async () => {
      // 1) Must be logged in
      const { data: auth } = await supabaseBrowser.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }

      // 2) Must be a member of a competition
      const { data: membership, error: mErr } = await supabaseBrowser
        .from("memberships")
        .select("competition_id")
        .eq("user_id", auth.user.id)
        .limit(1)
        .single();

      if (mErr || !membership) {
        window.location.href = "/setup";
        return;
      }

      const compId = membership.competition_id as string;

      // 3) Load rounds
      const { data, error } = await supabaseBrowser
        .from("rounds")
        .select("id, season, round_number, lock_time_utc")
        .eq("competition_id", compId)
        .eq("season", season)
        .order("round_number", { ascending: true });

      if (error) {
        setMsg(error.message);
        return;
      }

      setRounds((data ?? []) as RoundRow[]);
      setMsg("");
    })();
  }, [season]);

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1>Rounds • {season}</h1>

      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}

      {!msg && (
        <div style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
          {rounds.length === 0 ? (
            <div style={{ padding: 16 }}>No rounds found.</div>
          ) : (
            rounds.map((r, i) => (
              <Link
                key={r.id}
                href={`/round/${season}/${r.round_number}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: 14,
                  borderTop: i === 0 ? "none" : "1px solid #eee",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ fontWeight: 800 }}>Round {r.round_number}</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Locks: {formatMelbourne(r.lock_time_utc)}</div>
              </Link>
            ))
          )}
        </div>
      )}
    </main>
  );
}