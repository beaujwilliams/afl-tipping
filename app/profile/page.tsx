"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AFL_TEAMS } from "@/lib/afl-teams";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiBadge, UiCard, UiCardGrid } from "@/components/ui";

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

type LeaderboardRow = {
  user_id: string;
  rank: number;
  total_points: number;
  correct_tips: number;
  missed_tips: number;
  accuracy_pct: number;
  movement: number;
  behind_leader: number;
  current_streak: number;
  avg_winning_odds: number;
  round_score: number;
  tips_submitted: number;
  tips_possible: number;
};

type LeaderboardApiResponse = {
  ok?: boolean;
  error?: string;
  rows?: LeaderboardRow[];
};

type UsernameCheckState =
  | { status: "idle"; text: string | null }
  | { status: "checking"; text: string }
  | { status: "ok"; text: string }
  | { status: "error"; text: string };

function fmtPts(value: number) {
  return Number(value ?? 0).toFixed(2);
}

function fmtPct(value: number) {
  return `${Number(value ?? 0).toFixed(2)}%`;
}

function movementText(value: number) {
  if (value > 0) return `Up ${value}`;
  if (value < 0) return `Down ${Math.abs(value)}`;
  return "No change";
}

export default function ProfilePage() {
  const [userId, setUserId] = useState<string | null>(null);
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

  const [statsLoading, setStatsLoading] = useState(true);
  const [statsMsg, setStatsMsg] = useState<string | null>(null);
  const [myRow, setMyRow] = useState<LeaderboardRow | null>(null);

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
      setUserId(user.id);
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
    if (!userId) return;
    let alive = true;

    async function loadStats() {
      setStatsLoading(true);
      setStatsMsg(null);

      try {
        const res = await fetch(
          `/api/leaderboard?season=${encodeURIComponent(String(CURRENT_SEASON))}`,
          { cache: "no-store" }
        );

        const body = (await res.json().catch(() => null)) as LeaderboardApiResponse | null;
        if (!alive) return;

        if (!res.ok || !body?.ok) {
          setStatsMsg(body?.error ?? "Could not load season stats.");
          setMyRow(null);
          setStatsLoading(false);
          return;
        }

        const row = (body.rows ?? []).find((r) => r.user_id === userId) ?? null;
        setMyRow(row);
        if (!row) {
          setStatsMsg("No season stats yet.");
        }
      } catch {
        if (!alive) return;
        setStatsMsg("Could not load season stats.");
        setMyRow(null);
      } finally {
        if (!alive) return;
        setStatsLoading(false);
      }
    }

    loadStats();
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    if (loadingProfile) return;

    const normalized = normalizeUsername(username);
    const normalizedInitial = normalizeUsername(initialUsername);

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

    let canceled = false;
    const t = setTimeout(async () => {
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
    }, 250);

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
      setMsg(`${body?.error ?? "Failed to save profile."}${detail}`);
      return;
    }

    const nextUsername = body?.profile?.username ?? "";
    setUsername(nextUsername);
    setInitialUsername(nextUsername);
    setDisplayName(body?.profile?.display_name ?? "");
    setFavoriteTeam(body?.profile?.favorite_team ?? "");
    setMsg("Profile saved.");
  }

  if (loadingProfile) {
    return (
      <main className="ui-page ui-page--narrow">
        <div className="ui-page-header">
          <h1 className="ui-title">Profile</h1>
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
        <h1 className="ui-title">Profile</h1>
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
                  {team}
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

      <UiCard soft style={{ marginTop: 14 }}>
        <div className="ui-title--section">Season stats</div>
        <div className="ui-caption" style={{ marginTop: 6 }}>
          Your current standing and performance for {CURRENT_SEASON}.
        </div>

        {statsLoading ? (
          <div className="ui-caption" style={{ marginTop: 12 }}>
            Loading season stats…
          </div>
        ) : statsMsg ? (
          <div className="ui-caption" style={{ marginTop: 12 }}>
            {statsMsg}
          </div>
        ) : myRow ? (
          <UiCardGrid columns={3} style={{ marginTop: 12 }}>
            <UiCard>
              <div className="ui-kicker">Rank</div>
              <div className="ui-value">#{myRow.rank}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Total Points</div>
              <div className="ui-value">{fmtPts(myRow.total_points)}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Accuracy</div>
              <div className="ui-value">{fmtPct(myRow.accuracy_pct)}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Correct Tips</div>
              <div className="ui-value">{myRow.correct_tips}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Tips Submitted</div>
              <div className="ui-value">
                {myRow.tips_submitted}/{myRow.tips_possible}
              </div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Missed Tips</div>
              <div className="ui-value">{myRow.missed_tips}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Gap To Leader</div>
              <div className="ui-value">{fmtPts(myRow.behind_leader)}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Last Movement</div>
              <div className="ui-value">{movementText(myRow.movement)}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Current Streak</div>
              <div className="ui-value">{myRow.current_streak}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Last Round Score</div>
              <div className="ui-value">{fmtPts(myRow.round_score)}</div>
            </UiCard>
            <UiCard>
              <div className="ui-kicker">Avg Winning Odds</div>
              <div className="ui-value">{fmtPts(myRow.avg_winning_odds)}</div>
            </UiCard>
          </UiCardGrid>
        ) : null}
      </UiCard>
    </main>
  );
}
