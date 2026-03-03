"use client";

import "./globals.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import LogoutButton from "@/components/LogoutButton";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";
const BUILD_LABEL = process.env.NEXT_PUBLIC_BUILD_LABEL || "prod";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const pathname = usePathname();

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

  const isAdmin = (email ?? "").toLowerCase() === ADMIN_EMAIL;

  function NavItem({
    href,
    label,
  }: {
    href: string;
    label: string;
  }) {
    const active = pathname?.startsWith(href);

    return (
      <Link
        href={href}
        style={{
          padding: "8px 12px",
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 700,
          textDecoration: "none",
          background: active ? "rgba(0,0,0,0.06)" : "transparent",
          color: "inherit",
        }}
      >
        {label}
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
        {/* Header */}
        <header
          style={{
            borderBottom: "1px solid var(--border)",
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              maxWidth: 1000,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {/* Title */}
            <Link
              href="/"
              style={{
                fontWeight: 900,
                fontSize: 16,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              Needlessly Complicated AFL Tipping
            </Link>

            {/* Nav row */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
              }}
            >
              <NavItem href="/round/2026" label="Rounds" />
              <NavItem href="/leaderboard/2026" label="Leaderboard" />
              {isAdmin && <NavItem href="/admin" label="Admin" />}

              <div style={{ flex: 1 }} />

              {email ? (
                <>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {email}
                  </div>
                  <LogoutButton />
                </>
              ) : (
                <NavItem href="/login" label="Log in" />
              )}
            </div>

            {/* Build label */}
            <div style={{ fontSize: 11, opacity: 0.5 }}>
              build: {BUILD_LABEL}
            </div>
          </div>
        </header>

        {/* Page */}
        <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
          {children}
        </main>
      </body>
    </html>
  );
}