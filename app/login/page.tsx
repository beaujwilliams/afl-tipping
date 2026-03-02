"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signUp() {
    setError(null);
    setInfo(null);
    setLoading(true);

    const { error } = await supabaseBrowser.auth.signUp({ email, password });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // For dev: show guidance instead of assuming you're signed in
    setInfo(
      "Account created. If email confirmation is ON in Supabase, confirm your email, then come back and Sign In."
    );
  }

  async function signIn() {
    setError(null);
    setInfo(null);
    setLoading(true);

    const { error } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    // ✅ Confirm we actually have a session in the browser
    const { data } = await supabaseBrowser.auth.getSession();
    const session = data.session;

    setLoading(false);

    if (!session) {
      setError(
        "Sign-in returned no error, but no session exists. This usually means email confirmation is still required OR cookies are blocked. Check Supabase Auth settings (Confirm email) and try again."
      );
      return;
    }

    // If session exists, go to setup
    window.location.href = "/setup";
  }

  async function checkSession() {
    setError(null);
    const { data } = await supabaseBrowser.auth.getSession();
    if (data.session) {
      setInfo(`Session OK ✅ user=${data.session.user.email}`);
    } else {
      setInfo("No session (not logged in).");
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Needlessly Complicated AFL Tipping</h1>

      <div style={{ marginTop: 20 }}>
        <label>Email</label>
        <input
          style={{ width: "100%", padding: 10, marginTop: 6 }}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <label>Password</label>
        <input
          style={{ width: "100%", padding: 10, marginTop: 6 }}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <button
        type="button"
        onClick={signIn}
        disabled={loading}
        style={{ marginTop: 16, padding: 10, width: "100%" }}
      >
        {loading ? "Signing in..." : "Sign In"}
      </button>

      <button
        type="button"
        onClick={signUp}
        disabled={loading}
        style={{ marginTop: 12, padding: 10, width: "100%" }}
      >
        {loading ? "Creating..." : "Create Account"}
      </button>

      <button
        type="button"
        onClick={checkSession}
        style={{ marginTop: 12, padding: 10, width: "100%" }}
      >
        Check Session (debug)
      </button>

      {error && <p style={{ marginTop: 16, color: "red" }}>{error}</p>}
      {info && <p style={{ marginTop: 16 }}>{info}</p>}
    </main>
  );
}