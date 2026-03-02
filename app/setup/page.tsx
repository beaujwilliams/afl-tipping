"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function SetupPage() {
  const [msg, setMsg] = useState("Setting up your competition…");

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabaseBrowser.auth.getUser();
      const user = authData.user;

      if (!user) {
        window.location.href = "/login";
        return;
      }

      // If comp already exists, go to it
      const { data: existing, error: e1 } = await supabaseBrowser
        .from("competitions")
        .select("id, join_code")
        .limit(1);

      if (e1) {
        setMsg(`Error reading competitions: ${e1.message}`);
        return;
      }

      if (existing && existing.length > 0) {
        window.location.href = `/comp/${existing[0].join_code}`;
        return;
      }

      // Create comp
      const joinCode = "NEEDLESSLY";
      const { data: comp, error: e2 } = await supabaseBrowser
        .from("competitions")
        .insert({
          name: "Needlessly Complicated AFL Tipping",
          join_code: joinCode,
          owner_user_id: user.id,
        })
        .select("id, join_code")
        .single();

      if (e2) {
        setMsg(`Error creating competition: ${e2.message}`);
        return;
      }

      // Add owner membership
      const { error: e3 } = await supabaseBrowser.from("memberships").insert({
        competition_id: comp.id,
        user_id: user.id,
        role: "owner",
      });

      if (e3) {
        setMsg(`Error creating membership: ${e3.message}`);
        return;
      }

      window.location.href = `/comp/${comp.join_code}`;
    })();
  }, []);

  return (
    <main style={{ maxWidth: 700, margin: "40px auto", padding: 16 }}>
      <h1>Needlessly Complicated AFL Tipping</h1>
      <p>{msg}</p>
    </main>
  );
}