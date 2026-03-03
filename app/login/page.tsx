"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);

  const inCooldown = Date.now() < cooldownUntil;

  // ✅ Auto-forward if already logged in
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
    setBusy(true);

    const { error } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password,
    });

    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    window.location.href = "/round/2026";
  }

  async function signUp() {
    if (busy) return;

    if (inCooldown) {
      setMsg("Please wait a few seconds before trying again.");
      return;
    }

    setMsg(null);
    setBusy(true);

    try {
      const { data, error } = await supabaseBrowser.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });

      if (error) throw error;

      // If email confirmation is enabled
      if (!data.user) {
        setMsg("Check your email to confirm your account, then come back and sign in.");
      } else {
        setMsg("Account created successfully.");
      }

      // ⛔ Cooldown to prevent rapid re-attempts
      setCooldownUntil(Date.now() + 10000); // 10 seconds
    } catch (err: any) {
      setMsg(err?.message ?? "Signup failed.");
      setCooldownUntil(Date.now() + 10000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Needlessly Complicated AFL Tipping</h1>

      <form onSubmit={signIn} style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Email</div>
          <input
            disabled={busy}
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
            disabled={busy}
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
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <button
          type="button"
          disabled={busy || inCooldown}
          onClick={signUp}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "white",
            fontWeight: 700,
            cursor: busy || inCooldown ? "not-allowed" : "pointer",
            marginTop: 10,
            opacity: busy || inCooldown ? 0.6 : 1,
          }}
        >
          {busy ? "Creating…" : inCooldown ? "Please wait…" : "Create account"}
        </button>

        {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
      </form>
    </main>
  );
}