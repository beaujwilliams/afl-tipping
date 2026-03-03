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

function fmtMelbourne(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function SeasonRoundsPage() {
  const params = useParams<{ season: string }>();
  const season = Number(params.season);

  const [rows, setRows] = useState<RoundRow[]>([]);
  const [msg, setMsg] = useState("Checking session…");
  const [ready, setReady] = useState(false);

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

  const hasRows = useMemo(() => rows.length > 0, [rows.length]);

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1 style={{ margin: 0 }}>Rounds • {season}</h1>

      {msg && <p style={{ marginTop: 16, opacity: 0.8 }}>{msg}</p>}

      {!msg && !hasRows && (
        <div style={{ marginTop: 16, opacity: 0.75 }}>No rounds found.</div>
      )}

      {!msg && hasRows && (
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/round/${season}/${r.round_number}`}
              style={{
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 14,
                padding: 14,
                textDecoration: "none",
                color: "var(--foreground)",
                background: "rgba(255,255,255,0.04)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ fontWeight: 900 }}>Round {r.round_number}</div>
              <div style={{ opacity: 0.75, fontSize: 12, whiteSpace: "nowrap" }}>
                {fmtMelbourne(r.lock_time_utc)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}