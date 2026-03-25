"use client";

import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LogoutButton({ compact = false }: { compact?: boolean }) {
  return (
    <button
      onClick={async () => {
        await supabaseBrowser.auth.signOut();
        window.location.href = "/login";
      }}
      style={{
        padding: compact ? 0 : "10px 14px",
        borderRadius: compact ? 0 : 12,
        border: compact ? "none" : "1px solid rgba(255,255,255,0.18)",
        background: compact ? "transparent" : "rgba(255,255,255,0.06)",
        color: "inherit",
        fontSize: compact ? 13 : 15,
        fontWeight: compact ? 700 : 800,
        cursor: "pointer",
        opacity: compact ? 0.75 : 1,
      }}
    >
      Log out
    </button>
  );
}
