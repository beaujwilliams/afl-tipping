"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Row = {
  user_id: string;
  total_points: number;
  profiles: {
    display_name: string | null;
  } | null;
};

export default function LeaderboardPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<Row[]>([]);
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
        .from("leaderboard_entries")
        .select(`
          user_id,
          total_points,
          profiles:profiles(display_name)
        `)
        .eq("competition_id", comp.id)
        .eq("season", season)
        .order("total_points", { ascending: false });

      if (error) {
        setMsg(error.message);
        return;
      }

      setRows((data ?? []) as Row[]);
      setMsg("");
    })();
  }, [season]);

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1>Leaderboard • {season}</h1>
      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}

      {!msg && (
        <div
          style={{
            marginTop: 16,
            border: "1px solid #eee",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {rows.length === 0 ? (
            <div style={{ padding: 16 }}>
              No scores yet — once matches finish and you run scoring, this will
              populate.
            </div>
          ) : (
            rows.map((r, i) => (
              <div
                key={r.user_id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: 14,
                  borderTop: i === 0 ? "none" : "1px solid #eee",
                }}
              >
                <div>
                  <b>#{i + 1}</b>{" "}
                  <span style={{ opacity: 0.8 }}>
                    {r.profiles?.display_name ?? "Unknown"}
                  </span>
                </div>

                <div style={{ fontWeight: 700 }}>
                  {Number(r.total_points).toFixed(2)}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}