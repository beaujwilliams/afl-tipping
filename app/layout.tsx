"use client";

import "./globals.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import LogoutButton from "@/components/LogoutButton";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";
const BUILD_LABEL = process.env.NEXT_PUBLIC_BUILD_LABEL || "build-2026-03-04";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const pathname = usePathname();

  // 🔴 chat activity dot
  const [hasNewChat, setHasNewChat] = useState(false);

  function getLastChatSeenMs() {
    if (typeof window === "undefined") return 0;
    const v = window.localStorage.getItem("chat_last_seen_ms");
    return v ? Number(v) || 0 : 0;
  }

  function markChatSeenNow() {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("chat_last_seen_ms", String(Date.now()));
  }

  async function refreshChatActivity() {
    const { data } = await supabaseBrowser.auth.getSession();
    if (!data.session) return;

    const { data: rows, error } = await supabaseBrowser
      .from("chat_messages")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) return;

    const latest = rows?.[0]?.created_at
      ? new Date(rows[0].created_at).getTime()
      : 0;

    const lastSeen = getLastChatSeenMs();
    setHasNewChat(latest > lastSeen);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      const { data } = await supabaseBrowser.auth.getUser();
      if (!mounted) return;
      setEmail(data.user?.email ?? null);
    }

    load();

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange(() => {
      load();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Mark chat as seen when user visits /chat; otherwise poll for activity
  useEffect(() => {
    if (!pathname) return;

    if (pathname.startsWith("/chat")) {
      markChatSeenNow();
      setHasNewChat(false);
      return;
    }

    refreshChatActivity();
    const t = setInterval(() => refreshChatActivity(), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, email]);

  const isAdmin = (email ?? "").toLowerCase() === ADMIN_EMAIL;

  function NavItem({ href, label }: { href: string; label: string }) {
    const active = href === "/" ? pathname === "/" : (pathname ?? "").startsWith(href);
    const showDot = href === "/chat" && hasNewChat;

    return (
      <Link
        href={href}
        style={{
          padding: "10px 14px",
          borderRadius: 12,
          fontSize: 15,
          fontWeight: 700,
          textDecoration: "none",
          background: active ? "rgba(255,255,255,0.08)" : "transparent",
          color: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {label}
        {showDot && (
          <span
            aria-label="New chat messages"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "rgb(239,68,68)",
              display: "inline-block",
            }}
          />
        )}
      </Link>
    );
  }

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "var(--background)",
          color: "var(--foreground)",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <header
          style={{
            borderBottom: "1px solid var(--border)",
            padding: "18px 16px 14px",
          }}
        >
          <div
            style={{
              maxWidth: 1000,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Title */}
            <Link
              href="/"
              style={{
                fontWeight: 900,
                fontSize: 18,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              Needlessly Complicated AFL Tipping
            </Link>

            {/* Navigation */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
              }}
            >
              <NavItem href="/round/2026" label="Rounds" />
              <NavItem href="/leaderboard/2026" label="Leaderboard" />
              <NavItem href="/chat" label="Chat" />
              <NavItem href="/info" label="Rules" />
              {isAdmin && <NavItem href="/admin" label="Admin" />}

              <div style={{ flex: 1 }} />

              {email && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.6,
                      maxWidth: 220,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {email}
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.45 }}>{BUILD_LABEL}</div>
                </div>
              )}

              {email && (
                <div style={{ marginLeft: 10 }}>
                  <LogoutButton />
                </div>
              )}

              {!email && <NavItem href="/login" label="Log in" />}
            </div>
          </div>
        </header>

        <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
          {children}
        </main>
      </body>
    </html>
  );
}