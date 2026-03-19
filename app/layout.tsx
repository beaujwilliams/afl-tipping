"use client";

import "./globals.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ChatActivityProvider, useChatActivity } from "@/components/ChatActivityProvider";
import LogoutButton from "@/components/LogoutButton";

const BUILD_LABEL = process.env.NEXT_PUBLIC_BUILD_LABEL || "local dev";

function NavItem({
  href,
  label,
  pathname,
  unreadChat,
  unreadMentions,
  tone = "default",
}: {
  href: string;
  label: string;
  pathname: string;
  unreadChat: number;
  unreadMentions: number;
  tone?: "default" | "danger";
}) {
  const active =
    href === "/"
      ? pathname === "/"
      : pathname.startsWith(href);

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

function LayoutChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const { unreadChat, unreadMentions } = useChatActivity();

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "Complicated Tips";
    }
  }, [pathname]);

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

  return (
    <>
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
            <NavItem
              href="/round/2026"
              label="Tip"
              pathname={pathname ?? ""}
              unreadChat={unreadChat}
              unreadMentions={unreadMentions}
            />
            <NavItem
              href="/results/2026"
              label="Results"
              pathname={pathname ?? ""}
              unreadChat={unreadChat}
              unreadMentions={unreadMentions}
            />
            <NavItem
              href="/leaderboard/2026"
              label="Leaderboard"
              pathname={pathname ?? ""}
              unreadChat={unreadChat}
              unreadMentions={unreadMentions}
            />
            <NavItem
              href="/chat"
              label="Chat"
              pathname={pathname ?? ""}
              unreadChat={unreadChat}
              unreadMentions={unreadMentions}
            />
            <NavItem
              href="/info"
              label="How it works"
              pathname={pathname ?? ""}
              unreadChat={unreadChat}
              unreadMentions={unreadMentions}
            />
            {email && (
              <NavItem
                href="/profile"
                label="Profile"
                pathname={pathname ?? ""}
                unreadChat={unreadChat}
                unreadMentions={unreadMentions}
              />
            )}
            {isAdmin && (
              <NavItem
                href="/admin"
                label="Admin"
                pathname={pathname ?? ""}
                unreadChat={unreadChat}
                unreadMentions={unreadMentions}
                tone="danger"
              />
            )}

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

            {!email && (
              <NavItem
                href="/login"
                label="Log in"
                pathname={pathname ?? ""}
                unreadChat={unreadChat}
                unreadMentions={unreadMentions}
              />
            )}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
        {children}
      </main>
    </>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        <ChatActivityProvider>
          <LayoutChrome>{children}</LayoutChrome>
        </ChatActivityProvider>
      </body>
    </html>
  );
}
