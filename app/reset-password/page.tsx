"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [canReset, setCanReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>("Checking reset session…");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const { data } = await supabaseBrowser.auth.getSession();
      if (!mounted) return;

      if (data.session) {
        setCanReset(true);
        setMsg(null);
      } else {
        setCanReset(false);
        setMsg("Open the password reset link from your email to continue.");
      }

      setReady(true);
    }

    boot();

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || !!session) {
        setCanReset(true);
        setMsg(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !canReset) return;

    if (password.length < 8) {
      setMsg("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setMsg("Passwords do not match.");
      return;
    }

    setBusy(true);
    setMsg(null);

    const { error } = await supabaseBrowser.auth.updateUser({ password });

    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setDone(true);
    setMsg("Password updated. You can sign in now.");
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Set New Password</h1>

      {!ready && <p style={{ marginTop: 12 }}>{msg}</p>}

      {ready && !canReset && (
        <>
          {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
          <div style={{ marginTop: 16 }}>
            <Link href="/forgot-password" style={{ fontSize: 13, textDecoration: "underline", opacity: 0.85 }}>
              Request a new reset link
            </Link>
          </div>
        </>
      )}

      {ready && canReset && !done && (
        <form onSubmit={updatePassword} style={{ marginTop: 16 }}>
          <label style={{ display: "block", marginBottom: 10 }}>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>New password</div>
            <input
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </label>

          <label style={{ display: "block", marginBottom: 10 }}>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Confirm new password</div>
            <input
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              type="password"
              required
              placeholder="Re-enter password"
              autoComplete="new-password"
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
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
      )}

      {ready && done && (
        <div style={{ marginTop: 16 }}>
          {msg && <p>{msg}</p>}
          <Link href="/login" style={{ fontSize: 13, textDecoration: "underline", opacity: 0.85 }}>
            Go to login
          </Link>
        </div>
      )}

      {ready && msg && canReset && !done && <p style={{ marginTop: 12 }}>{msg}</p>}
    </main>
  );
}
