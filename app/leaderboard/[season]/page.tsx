"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Row = {
  user_id: string;
  total_points: number;
};

export default function LeaderboardPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<Row[]>([]);
  const [nameByUserId, setNameByUserId] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("Loading…");

  useEffect(() => {
    (async () => {
      setMsg("Loading…");

      const { data: auth } = await supabaseBrowser.auth.getUser();
      if (!auth.user) {
        window.location.href = "/login";
        return;
      }

      const { data: comp, error: compErr } = await supabaseBrowser
        .from("competitions")
        .select("id")
        .limit(1)
        .single();

      if (compErr || !comp) {
        setMsg("No competition found.");
        return;
      }

      const { data, error } = await supabaseBrowser
        .from("leaderboard_entries")
        .select("user_id, total_points")
        .eq("competition_id", comp.id)
        .eq("season", season)
        .order("total_points", { ascending: false });

      if (error) {
        setMsg(error.message);
        return;
      }

      const list = (data ?? []) as Row[];
      setRows(list);

      // fetch display names in a second query (no join required)
      const userIds = Array.from(new Set(list.map((r) => r.user_id)));
      if (userIds.length) {
        const { data: profs, error: pErr } = await supabaseBrowser
          .from("profiles")
          .select("id, display_name")
          .in("id", userIds);

        if (!pErr) {
          const map: Record<string, string> = {};
          (profs ?? []).forEach((p: any) => {
            const name = String(p.display_name ?? "").trim();
            if (name) map[String(p.id)] = name;
          });
          setNameByUserId(map);
        }
      }

      setMsg("");
    })();
  }, [season]);

  const displayRows = useMemo(() => {
    return rows.map((r) => ({
      ...r,
      display_name: nameByUserId[r.user_id] || `${r.user_id.slice(0, 8)}…`,
    }));
  }, [rows, nameByUserId]);

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
          {displayRows.length === 0 ? (
            <div style={{ padding: 16 }}>
              No scores yet — once matches finish and you run scoring, this will populate.
            </div>
          ) : (
            displayRows.map((r, i) => (
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
                  <b>#{i + 1}</b> <span style={{ opacity: 0.85 }}>{r.display_name}</span>
                </div>
                <div style={{ fontWeight: 700 }}>{Number(r.total_points).toFixed(2)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}