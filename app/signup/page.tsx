"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { validateUsername } from "@/lib/username";

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

type UsernameCheckResponse = {
  ok?: boolean;
  available?: boolean;
  error?: string;
};

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldownLeftMs, setCooldownLeftMs] = useState<number>(() => msLeftToCooldown());

  useEffect(() => {
    const t = setInterval(() => setCooldownLeftMs(msLeftToCooldown()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function goIfLoggedIn() {
      const { data } = await supabaseBrowser.auth.getSession();
      if (!mounted) return;
      if (data.session) window.location.href = "/round/2026";
    }

    goIfLoggedIn();

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      if (session) window.location.href = "/round/2026";
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const canSubmit = useMemo(() => cooldownLeftMs === 0 && !busy, [cooldownLeftMs, busy]);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    if (password !== confirmPassword) {
      setMsg("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setMsg("Password must be at least 6 characters.");
      return;
    }

    const usernameValidation = validateUsername(username);
    if (!usernameValidation.ok) {
      setMsg(usernameValidation.error);
      return;
    }
    const normalizedUsername = usernameValidation.value;

    const left = msLeftToCooldown();
    if (left > 0) {
      setMsg(`Please wait ${Math.ceil(left / 1000)}s before trying again.`);
      return;
    }

    setMsg(null);
    setBusy(true);

    const check = await fetch(
      `/api/username-check?username=${encodeURIComponent(normalizedUsername)}`,
      { cache: "no-store" }
    );
    const checkJson = (await check.json().catch(() => null)) as UsernameCheckResponse | null;

    if (!check.ok || !checkJson?.ok) {
      setBusy(false);
      setCooldownLeftMs(msLeftToCooldown());
      setMsg(checkJson?.error ?? "Could not validate username.");
      return;
    }

    if (!checkJson.available) {
      setBusy(false);
      setCooldownLeftMs(msLeftToCooldown());
      setMsg("That username is already taken.");
      return;
    }

    setCooldownNow();

    const { error } = await supabaseBrowser.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          username: normalizedUsername,
          display_name: normalizedUsername,
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

  return (
    <main className="ui-page" style={{ maxWidth: 460 }}>
      <h1 className="ui-title" style={{ fontSize: "clamp(2rem, 6vw, 2.4rem)" }}>
        Create account
      </h1>
      <div className="ui-caption" style={{ marginTop: 6 }}>
        Enter your details to join the comp.
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
            Username
          </div>
          <input
            className="ui-input"
            style={{ width: "100%" }}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            type="text"
            required
            placeholder="e.g. beau_w"
            autoComplete="username"
            maxLength={24}
          />
          <div className="ui-caption" style={{ marginTop: 6 }}>
            Lowercase letters, numbers, underscores only (3-24 chars).
          </div>
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
            Confirm password
          </div>
          <input
            className="ui-input"
            style={{ width: "100%" }}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            type="password"
            required
            placeholder="••••••••"
            autoComplete="new-password"
          />
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

        <Link href="/login" className="ui-btn" style={{ width: "100%", padding: 12 }}>
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
