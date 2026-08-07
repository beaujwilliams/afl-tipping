"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AFL_TEAMS } from "@/lib/afl-teams";
import { formatAflTeamNameForDisplay } from "@/lib/team-display";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useToast } from "@/components/ToastProvider";
import { UiBadge, UiCard } from "@/components/ui";

const CURRENT_SEASON = 2026;
const NO_TEAM_VALUE = "no AFL team";

type ProfileApiResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  profile?: {
    email: string | null;
    username: string | null;
    display_name: string | null;
    favorite_team: string | null;
  };
};

export default function ProfilePage() {
  const toast = useToast();
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [favoriteTeam, setFavoriteTeam] = useState(NO_TEAM_VALUE);

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function getAccessToken() {
    const { data } = await supabaseBrowser.auth.getSession();
    return data.session?.access_token ?? null;
  }

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      const { data: authData } = await supabaseBrowser.auth.getUser();
      const user = authData.user;
      if (!user) {
        window.location.href = "/login";
        return;
      }

      if (!mounted) return;
      setEmail(user.email ?? null);

      const token = await getAccessToken();
      if (!token) {
        if (!mounted) return;
        setMsg("Not authenticated");
        setLoadingProfile(false);
        return;
      }

      const res = await fetch("/api/profile", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });

      const body = (await res.json().catch(() => null)) as ProfileApiResponse | null;
      if (!mounted) return;

      if (!res.ok) {
        setMsg(body?.error ?? "Failed to load profile.");
        setLoadingProfile(false);
        return;
      }

      setDisplayName(body?.profile?.display_name ?? "");
      setFavoriteTeam(body?.profile?.favorite_team ?? NO_TEAM_VALUE);
      setEmail(body?.profile?.email ?? user.email ?? null);
      setLoadingProfile(false);
    }

    loadProfile();
    return () => {
      mounted = false;
    };
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    setSaving(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      setMsg("Not authenticated");
      toast.error("Not authenticated. Please sign in again.");
      return;
    }

    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        display_name: displayName,
        favorite_team: favoriteTeam,
      }),
    });

    const body = (await res.json().catch(() => null)) as ProfileApiResponse | null;
    setSaving(false);

    if (!res.ok) {
      const detail = body?.details ? ` (${body.details})` : "";
      toast.error(`${body?.error ?? "Failed to save profile."}${detail}`);
      return;
    }

    setDisplayName(body?.profile?.display_name ?? "");
    setFavoriteTeam(body?.profile?.favorite_team ?? NO_TEAM_VALUE);
    toast.success("Profile saved.");
  }

  if (loadingProfile) {
    return (
      <main className="ui-page ui-page--narrow">
        <div className="ui-page-header">
          <h1 className="ui-title">My Profile</h1>
          <UiBadge>Season {CURRENT_SEASON}</UiBadge>
        </div>
        <UiCard soft style={{ marginTop: 16 }}>
          <div className="ui-caption">Loading profile…</div>
        </UiCard>
      </main>
    );
  }

  return (
    <main className="ui-page ui-page--narrow">
      <div className="ui-page-header">
        <h1 className="ui-title">My Profile</h1>
        <UiBadge>Season {CURRENT_SEASON}</UiBadge>
      </div>

      <UiCard soft style={{ marginTop: 16 }}>
        <div className="ui-title--section">Profile settings</div>
        <div className="ui-caption" style={{ marginTop: 6 }}>
          Update your display name and team. Choose no AFL team if you do not support one.
        </div>

        <form onSubmit={saveProfile} className="ui-stack" style={{ marginTop: 14 }}>
          <label className="ui-stack">
            <div className="ui-caption">Email</div>
            <input
              className="ui-input"
              style={{ width: "100%", opacity: 0.8 }}
              type="email"
              value={email ?? ""}
              readOnly
              disabled
            />
          </label>

          <label className="ui-stack">
            <div className="ui-caption">Display name</div>
            <input
              className="ui-input"
              style={{ width: "100%" }}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              type="text"
              maxLength={80}
              placeholder="How your name appears on leaderboard/chat"
            />
          </label>

          <label className="ui-stack">
            <div className="ui-caption">Team</div>
            <select
              className="ui-input"
              style={{ width: "100%" }}
              value={favoriteTeam}
              onChange={(e) => setFavoriteTeam(e.target.value)}
            >
              {AFL_TEAMS.map((team) => (
                <option key={team} value={team}>
                  {formatAflTeamNameForDisplay(team, { season: CURRENT_SEASON })}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={saving}
            className="ui-btn"
            style={{ width: "100%", padding: "12px 14px", fontSize: 16 }}
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </form>

        <div style={{ marginTop: 12, fontSize: 14 }}>
          <Link href="/forgot-password" style={{ textDecoration: "underline", opacity: 0.85 }}>
            Change password
          </Link>
        </div>

        {msg && <div style={{ marginTop: 12, fontSize: 14 }}>{msg}</div>}
      </UiCard>
    </main>
  );
}
