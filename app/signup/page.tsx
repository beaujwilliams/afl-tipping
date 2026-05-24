"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AFL_TEAMS } from "@/lib/afl-teams";
import NextSeasonInterestForm from "@/components/NextSeasonInterestForm";
import { CURRENT_SEASON, NEXT_SEASON, SIGNUPS_OPEN } from "@/lib/season-config";
import { formatAflTeamNameForDisplay } from "@/lib/team-display";

const SIGNUP_COOLDOWN_MS = 60_000;
const SIGNUP_COOLDOWN_KEY = "afl_last_signup_attempt_ms";

function msLeftToCooldown(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(SIGNUP_COOLDOWN_KEY);
  const last = raw ? Number(raw) : 0;
  if (!last || Number.isNaN(last)) return 0;
  const left = SIGNUP_COOLDOWN_MS - (Date.now() - last);
  return Math.max(0, left);
}

function setCooldownNow() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SIGNUP_COOLDOWN_KEY, String(Date.now()));
}

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [favoriteTeam, setFavoriteTeam] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldownLeftMs, setCooldownLeftMs] = useState<number>(() => msLeftToCooldown());

  useEffect(() => {
    const t = setInterval(() => setCooldownLeftMs(msLeftToCooldown()), 500);
    return () => clearInterval(t);
  }, []);

  const canSubmit = useMemo(() => cooldownLeftMs === 0 && !busy, [cooldownLeftMs, busy]);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!SIGNUPS_OPEN) {
      setMsg(`Signups are currently paused while season ${CURRENT_SEASON} is in progress.`);
      return;
    }
    if (!canSubmit) return;

    if (password.length < 6) {
      setMsg("Password must be at least 6 characters.");
      return;
    }
    if (!favoriteTeam) {
      setMsg("Please select your AFL team.");
      return;
    }

    const left = msLeftToCooldown();
    if (left > 0) {
      setMsg(`Please wait ${Math.ceil(left / 1000)}s before trying again.`);
      return;
    }

    setMsg(null);
    setBusy(true);

    setCooldownNow();
    const trimmedEmail = email.trim();
    const emailLocalName = trimmedEmail.split("@")[0]?.trim() ?? "";
    const { supabaseBrowser } = await import("@/lib/supabase-browser");

    const { error } = await supabaseBrowser.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          display_name: emailLocalName || null,
          favorite_team: favoriteTeam,
        },
      },
    });

    setBusy(false);
    setCooldownLeftMs(msLeftToCooldown());

    if (error) {
      const m = error.message?.toLowerCase?.() ?? "";
      if (m.includes("rate limit")) {
        setMsg("Too many signup emails were requested. Please wait a minute and try again.");
      } else {
        setMsg(error.message);
      }
      return;
    }

    setMsg("Account created. Check your email to confirm, then log in.");
  }

  if (!SIGNUPS_OPEN) {
    return (
      <main className="ui-page" style={{ maxWidth: 460 }}>
        <h1 className="ui-title" style={{ fontSize: "clamp(2rem, 6vw, 2.4rem)" }}>
          Signups Paused
        </h1>
        <div className="ui-caption" style={{ marginTop: 6 }}>
          Season {CURRENT_SEASON} is already in progress, so new account creation is disabled.
        </div>

        <div className="ui-card ui-stack" style={{ marginTop: 16 }}>
          <div className="ui-caption">
            Register interest and we will notify you when season {NEXT_SEASON} signup opens.
          </div>
          <NextSeasonInterestForm season={NEXT_SEASON} />
        </div>

        <Link
          href="/login"
          prefetch={false}
          className="ui-btn"
          style={{ width: "100%", padding: 12, marginTop: 12 }}
        >
          Back to login
        </Link>
      </main>
    );
  }

  return (
    <main className="ui-page" style={{ maxWidth: 460 }}>
      <h1 className="ui-title" style={{ fontSize: "clamp(2rem, 6vw, 2.4rem)" }}>
        Create account
      </h1>
      <div className="ui-caption" style={{ marginTop: 6 }}>
        Enter your email, password and AFL team to join the comp.
      </div>

      <form onSubmit={createAccount} className="ui-card ui-stack" style={{ marginTop: 16 }}>
        <label>
          <div className="ui-caption" style={{ marginBottom: 6 }}>
            Email
          </div>
          <input
            className="ui-input"
            style={{ width: "100%" }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>

        <label>
          <div className="ui-caption" style={{ marginBottom: 6 }}>
            Password
          </div>
          <input
            className="ui-input"
            style={{ width: "100%" }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </label>

        <label>
          <div className="ui-caption" style={{ marginBottom: 6 }}>
            AFL team
          </div>
          <select
            className="ui-input"
            style={{ width: "100%" }}
            value={favoriteTeam}
            onChange={(e) => setFavoriteTeam(e.target.value)}
            required
          >
            <option value="">Select your team</option>
            {AFL_TEAMS.map((team) => (
              <option key={team} value={team}>
                {formatAflTeamNameForDisplay(team, { season: CURRENT_SEASON })}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={!canSubmit}
          className="ui-btn"
          style={{ width: "100%", padding: 12 }}
        >
          {busy
            ? "Creating..."
            : cooldownLeftMs > 0
              ? `Create account (wait ${Math.ceil(cooldownLeftMs / 1000)}s)`
              : "Create account"}
        </button>

        <Link href="/login" prefetch={false} className="ui-btn" style={{ width: "100%", padding: 12 }}>
          Back to login
        </Link>

        {msg && (
          <p className="ui-caption" style={{ marginTop: 6 }}>
            {msg}
          </p>
        )}
      </form>
    </main>
  );
}
