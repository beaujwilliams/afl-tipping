"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AFL_TEAMS } from "@/lib/afl-teams";
import { supabaseBrowser } from "@/lib/supabase-browser";

type ProfileApiResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  profile?: {
    email: string | null;
    display_name: string | null;
    favorite_team: string | null;
  };
};

export default function ProfilePage() {
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [favoriteTeam, setFavoriteTeam] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const { data: authData } = await supabaseBrowser.auth.getUser();
      const user = authData.user;

      if (!user) {
        window.location.href = "/login";
        return;
      }

      if (!mounted) return;
      setEmail(user.email ?? null);

      const res = await fetch("/api/profile", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as ProfileApiResponse | null;

      if (!mounted) return;

      if (!res.ok) {
        setMsg(body?.error ?? "Failed to load profile.");
        setLoading(false);
        return;
      }

      setDisplayName(body?.profile?.display_name ?? "");
      setFavoriteTeam(body?.profile?.favorite_team ?? "");
      setEmail(body?.profile?.email ?? user.email ?? null);
      setLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    setSaving(true);
    setMsg(null);

    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: displayName,
        favorite_team: favoriteTeam || null,
      }),
    });

    const body = (await res.json().catch(() => null)) as ProfileApiResponse | null;
    setSaving(false);

    if (!res.ok) {
      const detail = body?.details ? ` (${body.details})` : "";
      setMsg(`${body?.error ?? "Failed to save profile."}${detail}`);
      return;
    }

    setDisplayName(body?.profile?.display_name ?? "");
    setFavoriteTeam(body?.profile?.favorite_team ?? "");
    setMsg("Profile saved.");
  }

  if (loading) {
    return (
      <main style={{ maxWidth: 520, margin: "20px auto", padding: 16 }}>
        <h1>Your Profile</h1>
        <p>Loading profile…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 520, margin: "20px auto", padding: 16 }}>
      <h1>Your Profile</h1>

      <form onSubmit={saveProfile} style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 12 }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Email</div>
          <input
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "#f7f7f7",
              color: "#333",
            }}
            type="email"
            value={email ?? ""}
            readOnly
            disabled
          />
        </label>

        <label style={{ display: "block", marginBottom: 12 }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Display name</div>
          <input
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            type="text"
            maxLength={80}
            placeholder="How your name appears on leaderboard/chat"
          />
        </label>

        <label style={{ display: "block", marginBottom: 12 }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Favourite team</div>
          <select
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            value={favoriteTeam}
            onChange={(e) => setFavoriteTeam(e.target.value)}
          >
            <option value="">None selected</option>
            {AFL_TEAMS.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={saving}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "white",
            fontWeight: 800,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>

      <div style={{ marginTop: 16, fontSize: 14 }}>
        <Link href="/forgot-password" style={{ textDecoration: "underline", opacity: 0.85 }}>
          Change password
        </Link>
      </div>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </main>
  );
}
