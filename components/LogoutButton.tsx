"use client";

import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await supabaseBrowser.auth.signOut();
        window.location.href = "/login";
      }}
      style={{
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.06)",
        color: "inherit",
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      Log out
    </button>
  );
}