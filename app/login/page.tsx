"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ✅ Auto-forward if already logged in
  useEffect(() => {
    (async () => {
      const { data } = await supabaseBrowser.auth.getSession();
      if (data.session) {
        window.location.href = "/round/2026";
      }
    })();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
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
    setMsg(null);
    setBusy(true);

    const { error } = await supabaseBrowser.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Account created. Check your email to confirm, then come back and sign in.");
  }

  async function signOut() {
    setMsg(null);
    await supabaseBrowser.auth.signOut();
    setMsg("Signed out.");
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
            cursor: "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={signUp}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "white",
            fontWeight: 700,
            cursor: "pointer",
            marginTop: 10,
          }}
        >
          {busy ? "Creating…" : "Create account"}
        </button>

        <button
          type="button"
          onClick={signOut}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #eee",
            background: "#fafafa",
            fontWeight: 600,
            cursor: "pointer",
            marginTop: 10,
          }}
        >
          Sign out (debug)
        </button>

        {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
      </form>
    </main>
  );
}