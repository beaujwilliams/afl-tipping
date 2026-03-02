"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
};

export default function SeasonRoundsPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<RoundRow[]>([]);
  const [msg, setMsg] = useState("Loading…");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabaseBrowser.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }

      const { data: comp } = await supabaseBrowser
        .from("competitions")
        .select("id")
        .limit(1)
        .single();

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
  }, [season]);

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1>Rounds • {season}</h1>
      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}

      {!msg && (
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/round/${season}/${r.round_number}`}
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 14,
                textDecoration: "none",
                color: "black",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <div style={{ fontWeight: 800 }}>Round {r.round_number}</div>
              <div style={{ opacity: 0.75, fontSize: 12 }}>
                {r.lock_time_utc ? new Date(r.lock_time_utc).toLocaleString() : ""}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}