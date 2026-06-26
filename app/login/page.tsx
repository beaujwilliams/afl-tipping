"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import PublicPreviewTeaser from "@/components/PublicPreviewTeaser";
import { UiButton, UiButtonLink } from "@/components/ui";
import { CURRENT_SEASON, NEXT_SEASON, SIGNUPS_OPEN } from "@/lib/season-config";

async function loadSupabaseBrowser() {
  const mod = await import("@/lib/supabase-browser");
  return mod.supabaseBrowser;
}

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

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    setMsg(null);
    setBusy(true);
    const supabaseBrowser = await loadSupabaseBrowser();

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
            prefetch={false}
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
              prefetch={false}
              style={{ width: "100%", padding: 12, marginTop: 6 }}
            >
              Create account
            </UiButtonLink>
          </>
        ) : null}

        {displayMsg && (
          <p style={{ marginTop: 12 }} className="ui-caption">
            {displayMsg}
          </p>
        )}
      </form>

      <PublicPreviewTeaser
        seasonNote={
          !SIGNUPS_OPEN
            ? `Season ${CURRENT_SEASON} is in progress, so new account creation is paused.`
            : undefined
        }
        secondaryButtonLabel={!SIGNUPS_OPEN ? `Register your interest for ${NEXT_SEASON} season` : undefined}
        secondaryHref={!SIGNUPS_OPEN ? "/next-season" : undefined}
      />
    </main>
  );
}
