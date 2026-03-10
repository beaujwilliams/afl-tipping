"use client";

import "./globals.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import LogoutButton from "@/components/LogoutButton";

const BUILD_LABEL = process.env.NEXT_PUBLIC_BUILD_LABEL || "local dev";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const pathname = usePathname();

  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadMentions, setUnreadMentions] = useState(0);

  function getLastChatSeenMs() {
    if (typeof window === "undefined") return 0;
    const v = window.localStorage.getItem("chat_last_seen_ms");
    return v ? Number(v) || 0 : 0;
  }

  function markChatSeenNow() {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("chat_last_seen_ms", String(Date.now()));
  }

  function isMissingRelationError(message: string, relationName: string) {
    const m = String(message || "").toLowerCase();
    const rel = relationName.toLowerCase();
    return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
  }

  async function refreshChatActivity() {
    const { data } = await supabaseBrowser.auth.getSession();
    if (!data.session) {
      setUnreadChat(0);
      setUnreadMentions(0);
      return;
    }

    const lastSeen = getLastChatSeenMs();
    const sinceIso = new Date(lastSeen).toISOString();

    const { count, error } = await supabaseBrowser
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .gt("created_at", sinceIso);

    if (error) return;
    setUnreadChat(count ?? 0);

    const { count: mentionCount, error: mentionErr } = await supabaseBrowser
      .from("chat_message_mentions")
      .select("id", { count: "exact", head: true })
      .eq("mentioned_user_id", data.session.user.id)
      .gt("created_at", sinceIso);

    if (mentionErr) {
      if (isMissingRelationError(mentionErr.message, "chat_message_mentions")) {
        setUnreadMentions(0);
      }
      return;
    }
    setUnreadMentions(mentionCount ?? 0);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      const { data } = await supabaseBrowser.auth.getUser();
      if (!mounted) return;
      const user = data.user;
      setEmail(user?.email ?? null);

      if (!user?.id) {
        setIsAdmin(false);
        return;
      }

      const { data: adminMembership, error: adminErr } = await supabaseBrowser
        .from("memberships")
        .select("user_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin"])
        .limit(1)
        .maybeSingle();

      if (!mounted) return;
      if (adminErr) {
        setIsAdmin(false);
        return;
      }

      setIsAdmin(!!adminMembership);
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

  useEffect(() => {
    if (!pathname) return;

    if (pathname.startsWith("/chat")) {
      const previousSeen = getLastChatSeenMs();
      if (typeof window !== "undefined") {
        window.localStorage.setItem("chat_last_seen_snapshot_ms", String(previousSeen));
      }
      markChatSeenNow();
      setUnreadChat(0);
      setUnreadMentions(0);
      return;
    }

    refreshChatActivity();

    const t = setInterval(() => refreshChatActivity(), 30000);
    return () => clearInterval(t);
  }, [pathname, email]);

  function NavItem({
    href,
    label,
    tone = "default",
  }: {
    href: string;
    label: string;
    tone?: "default" | "danger";
  }) {
    const active =
      href === "/"
        ? pathname === "/"
        : (pathname ?? "").startsWith(href);

    const isChat = href === "/chat";

    const isDanger = tone === "danger";

    return (
      <Link
        href={href}
        style={{
          padding: "10px 14px",
          borderRadius: 12,
          fontSize: 15,
          fontWeight: 700,
          textDecoration: "none",
          background: active
            ? isDanger
              ? "rgba(239, 68, 68, 0.12)"
              : "rgba(255,255,255,0.08)"
            : "transparent",
          color: isDanger ? "rgb(185, 28, 28)" : "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {label}
        {isChat && unreadChat > 0 && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 900,
              background: "rgb(239,68,68)",
              color: "white",
              borderRadius: 999,
              padding: "2px 7px",
              lineHeight: 1,
            }}
          >
            {unreadChat}
          </span>
        )}
        {isChat && unreadMentions > 0 && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 900,
              background: "rgb(217, 119, 6)",
              color: "white",
              borderRadius: 999,
              padding: "2px 7px",
              lineHeight: 1,
            }}
          >
            @{unreadMentions}
          </span>
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
          fontFamily: "var(--font-sans)",
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

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
              }}
            >
              <NavItem href="/round/2026" label="Tip" />
              <NavItem href="/results/2026" label="Results" />
              <NavItem href="/leaderboard/2026" label="Leaderboard" />
              <NavItem href="/chat" label="Chat" />
              <NavItem href="/info" label="How it works" />
              {email && <NavItem href="/profile" label="Profile" />}
              {isAdmin && <NavItem href="/admin" label="Admin" tone="danger" />}

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

                  <div style={{ fontSize: 12, opacity: 0.45 }}>
                    {BUILD_LABEL}
                  </div>
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
