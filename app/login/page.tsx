"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

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

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [msg, setMsg] = useState<string | null>(null);

  const [busySignIn, setBusySignIn] = useState(false);
  const [busySignUp, setBusySignUp] = useState(false);

  const busy = busySignIn || busySignUp;

  const [cooldownLeftMs, setCooldownLeftMs] = useState<number>(() => msLeftToCooldown());
  useEffect(() => {
    // tick cooldown text while on page
    const t = setInterval(() => setCooldownLeftMs(msLeftToCooldown()), 500);
    return () => clearInterval(t);
  }, []);

  const canSignUp = useMemo(() => cooldownLeftMs === 0 && !busy, [cooldownLeftMs, busy]);

  // ✅ Auto-forward if already logged in (initial check + auth change listener)
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

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    setMsg(null);
    setBusySignIn(true);

    const { error } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password,
    });

    setBusySignIn(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    window.location.href = "/round/2026";
  }

  async function signUp() {
    if (busy) return;

    const left = msLeftToCooldown();
    if (left > 0) {
      const secs = Math.ceil(left / 1000);
      setMsg(`Please wait ${secs}s before trying again.`);
      return;
    }

    setMsg(null);
    setBusySignUp(true);
    setCooldownNow(); // ✅ throttle immediately to stop spam taps

    const { error } = await supabaseBrowser.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    setBusySignUp(false);
    setCooldownLeftMs(msLeftToCooldown());

    if (error) {
      // Friendlier copy for the common rate limit case
      const m = error.message?.toLowerCase?.() ?? "";
      if (m.includes("rate limit")) {
        setMsg("Too many signup emails were requested. Please wait a minute and try again.");
      } else {
        setMsg(error.message);
      }
      return;
    }

    setMsg("Account created. Check your email to confirm, then come back and sign in.");
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Needlessly Complicated AFL Tipping</h1>

      <form onSubmit={signIn} style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Email</div>
          <input
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>

        <label style={{ display: "block", marginBottom: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Password</div>
          <input
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "white",
            fontWeight: 800,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busySignIn ? "Signing in…" : "Sign in"}
        </button>

        <div style={{ marginTop: 10, textAlign: "right" }}>
          <Link
            href="/forgot-password"
            style={{ fontSize: 13, textDecoration: "underline", opacity: 0.85 }}
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="button"
          disabled={!canSignUp}
          onClick={signUp}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "white",
            fontWeight: 700,
            cursor: canSignUp ? "pointer" : "not-allowed",
            opacity: canSignUp ? 1 : 0.7,
            marginTop: 10,
          }}
        >
          {busySignUp
            ? "Creating…"
            : cooldownLeftMs > 0
            ? `Create account (wait ${Math.ceil(cooldownLeftMs / 1000)}s)`
            : "Create account"}
        </button>

        {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
      </form>
    </main>
  );
}
