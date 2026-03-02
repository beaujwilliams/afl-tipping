"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function CompPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code || "").toUpperCase();
  const [msg, setMsg] = useState("Loading…");
  const [compName, setCompName] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabaseBrowser.auth.getUser();
      const user = authData.user;

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const { data: comp, error: e1 } = await supabaseBrowser
        .from("competitions")
        .select("id, name, join_code")
        .eq("join_code", code)
        .single();

      if (e1 || !comp) {
        setMsg("Competition not found. Check the join code.");
        return;
      }

      setCompName(comp.name);

      // Auto-join
      const { error: e2 } = await supabaseBrowser.from("memberships").upsert({
        competition_id: comp.id,
        user_id: user.id,
        role: "member",
      });

      if (e2) {
        setMsg(`Joined, but membership save failed: ${e2.message}`);
        return;
      }

      setMsg("You’re in ✅ Next: fixture sync + tipping page.");
    })();
  }, [code]);

  return (
    <main style={{ maxWidth: 700, margin: "40px auto", padding: 16 }}>
      <h1>{compName ?? "Needlessly Complicated AFL Tipping"}</h1>
      <p>
        Join code: <b>{code}</b>
      </p>
      <p style={{ marginTop: 16 }}>{msg}</p>
    </main>
  );
}