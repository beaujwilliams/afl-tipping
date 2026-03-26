"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiButton, UiButtonLink } from "@/components/ui";
import { CURRENT_SEASON, NEXT_SEASON, SIGNUPS_OPEN } from "@/lib/season-config";

export default function LoginPage() {
  const postLoginHref = "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [callbackError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("error");
  });
  const displayMsg = useMemo(() => msg ?? callbackError, [msg, callbackError]);

  // ✅ Auto-forward if already logged in (initial check + auth change listener)
  useEffect(() => {
    let mounted = true;

    async function goIfLoggedIn() {
      const { data, error } = await supabaseBrowser.auth.getUser();
      if (!mounted) return;
      if (error) return;
      if (data.user) window.location.replace(postLoginHref);
    }

    goIfLoggedIn();

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_IN" && session) {
        window.location.replace(postLoginHref);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [postLoginHref]);

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

    window.location.href = postLoginHref;
  }

  return (
    <main className="ui-page" style={{ maxWidth: 420 }}>
      <h1 className="ui-title" style={{ fontSize: "clamp(2rem, 6vw, 2.4rem)" }}>
        Log in
      </h1>
      <div className="ui-caption" style={{ marginTop: 6 }}>
        Sign in to continue tipping.
      </div>

      <form onSubmit={signIn} className="ui-card ui-stack" style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 10 }}>
          <div className="ui-caption" style={{ marginBottom: 6 }}>Email</div>
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

        <label style={{ display: "block", marginBottom: 10 }}>
          <div className="ui-caption" style={{ marginBottom: 6 }}>Password</div>
          <input
            className="ui-input"
            style={{ width: "100%" }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </label>

        <UiButton
          type="submit"
          disabled={busy}
          style={{ width: "100%", padding: 12 }}
        >
          {busy ? "Signing in..." : "Sign in"}
        </UiButton>

        <div style={{ marginTop: 10, textAlign: "right" }}>
          <Link
            href="/forgot-password"
            style={{ fontSize: 13, textDecoration: "underline", opacity: 0.85 }}
          >
            Forgot password?
          </Link>
        </div>

        {SIGNUPS_OPEN ? (
          <>
            <div className="ui-caption" style={{ textAlign: "center", marginTop: 8 }}>
              New here?
            </div>
            <UiButtonLink
              href="/signup"
              style={{ width: "100%", padding: 12, marginTop: 6 }}
            >
              Create account
            </UiButtonLink>
          </>
        ) : (
          <div className="ui-card ui-stack ui-card-soft" style={{ marginTop: 8 }}>
            <div className="ui-caption">
              Season {CURRENT_SEASON} is in progress, so new account creation is paused.
            </div>
            <UiButtonLink href="/next-season" style={{ width: "100%", padding: 12 }}>
              Register your interest for {NEXT_SEASON} season
            </UiButtonLink>
          </div>
        )}

        {displayMsg && (
          <p style={{ marginTop: 12 }} className="ui-caption">
            {displayMsg}
          </p>
        )}
      </form>
    </main>
  );
}
