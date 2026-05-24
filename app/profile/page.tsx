"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AFL_TEAMS } from "@/lib/afl-teams";
import { formatAflTeamNameForDisplay } from "@/lib/team-display";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useToast } from "@/components/ToastProvider";
import { UiBadge, UiCard } from "@/components/ui";

const CURRENT_SEASON = 2026;

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

type UsernameCheckState =
  | { status: "idle"; text: string | null }
  | { status: "checking"; text: string }
  | { status: "ok"; text: string }
  | { status: "error"; text: string };

export default function ProfilePage() {
  const toast = useToast();
  const [email, setEmail] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [initialUsername, setInitialUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [favoriteTeam, setFavoriteTeam] = useState("");

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [usernameCheck, setUsernameCheck] = useState<UsernameCheckState>({
    status: "idle",
    text: "Use lowercase letters, numbers, and underscores.",
  });

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

      const nextUsername = body?.profile?.username ?? "";
      setDisplayName(body?.profile?.display_name ?? "");
      setUsername(nextUsername);
      setInitialUsername(nextUsername);
      setFavoriteTeam(body?.profile?.favorite_team ?? "");
      setEmail(body?.profile?.email ?? user.email ?? null);
      setLoadingProfile(false);
    }

    loadProfile();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (loadingProfile) return;

    const normalized = normalizeUsername(username);
    const normalizedInitial = normalizeUsername(initialUsername);

    let canceled = false;
    const t = setTimeout(async () => {
      if (!normalized) {
        setUsernameCheck({
          status: "idle",
          text: "Username can be left blank, but a unique username helps mentions in chat.",
        });
        return;
      }

      if (normalized === normalizedInitial) {
        setUsernameCheck({ status: "ok", text: "This is your current username." });
        return;
      }

      const validation = validateUsername(normalized);
      if (!validation.ok) {
        setUsernameCheck({ status: "error", text: validation.error });
        return;
      }

      setUsernameCheck({ status: "checking", text: "Checking username…" });

      try {
        const res = await fetch(
          `/api/username-check?username=${encodeURIComponent(validation.value)}`,
          { cache: "no-store" }
        );
        const body = (await res.json().catch(() => null)) as
          | { ok?: boolean; available?: boolean; error?: string }
          | null;

        if (canceled) return;

        if (!res.ok || !body?.ok) {
          setUsernameCheck({
            status: "error",
            text: body?.error ?? "Could not validate username right now.",
          });
          return;
        }

        setUsernameCheck(
          body.available
            ? { status: "ok", text: "Username is available." }
            : { status: "error", text: "Username is already taken." }
        );
      } catch {
        if (canceled) return;
        setUsernameCheck({
          status: "error",
          text: "Could not validate username right now.",
        });
      }
    }, 150);

    return () => {
      canceled = true;
      clearTimeout(t);
    };
  }, [username, initialUsername, loadingProfile]);

  const usernameHelpColor = useMemo(() => {
    if (usernameCheck.status === "ok") return "rgb(22, 163, 74)";
    if (usernameCheck.status === "error") return "rgb(220, 38, 38)";
    return "var(--muted)";
  }, [usernameCheck.status]);

  const blockSaveForUsername =
    usernameCheck.status === "checking" || usernameCheck.status === "error";

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (saving || blockSaveForUsername) return;

    setSaving(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setSaving(false);
      setMsg("Not authenticated");
      toast.error("Not authenticated. Please sign in again.");
      return;
    }

    const normalizedUsername = normalizeUsername(username);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        username: normalizedUsername || null,
        display_name: displayName,
        favorite_team: favoriteTeam || null,
      }),
    });

    const body = (await res.json().catch(() => null)) as ProfileApiResponse | null;
    setSaving(false);

    if (!res.ok) {
      const detail = body?.details ? ` (${body.details})` : "";
      toast.error(`${body?.error ?? "Failed to save profile."}${detail}`);
      return;
    }

    const nextUsername = body?.profile?.username ?? "";
    setUsername(nextUsername);
    setInitialUsername(nextUsername);
    setDisplayName(body?.profile?.display_name ?? "");
    setFavoriteTeam(body?.profile?.favorite_team ?? "");
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
          Update your display name, username and favourite team.
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
            <div className="ui-caption">Username</div>
            <input
              className="ui-input"
              style={{ width: "100%" }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              type="text"
              maxLength={24}
              autoComplete="username"
              placeholder="lowercase, numbers, underscores"
            />
            {usernameCheck.text && (
              <div className="ui-caption" style={{ color: usernameHelpColor }}>
                {usernameCheck.text}
              </div>
            )}
          </label>

          <label className="ui-stack">
            <div className="ui-caption">Favourite team</div>
            <select
              className="ui-input"
              style={{ width: "100%" }}
              value={favoriteTeam}
              onChange={(e) => setFavoriteTeam(e.target.value)}
            >
              <option value="">None selected</option>
              {AFL_TEAMS.map((team) => (
                <option key={team} value={team}>
                  {formatAflTeamNameForDisplay(team, { season: CURRENT_SEASON })}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={saving || blockSaveForUsername}
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
