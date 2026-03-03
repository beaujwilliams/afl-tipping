"use client";

import "./globals.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import LogoutButton from "@/components/LogoutButton";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [email, setEmail] = useState<string | null>(null);

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

  const isAdmin = (email ?? "").toLowerCase() === "beau.j.williams@gmail.com";

  return (
    <html lang="en">
      <body>
        <header
          style={{
            borderBottom: "1px solid #eee",
            padding: "14px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontWeight: 800 }}>
            <Link href="/" style={{ textDecoration: "none", color: "black" }}>
              Needlessly Complicated AFL Tipping
            </Link>
          </div>

          <nav
            style={{
              display: "flex",
              gap: 16,
              fontSize: 14,
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <Link href="/round/2026">Rounds</Link>
            <Link href="/leaderboard/2026">Leaderboard</Link>

            {isAdmin && (
              <Link href="/admin" style={{ fontWeight: 800, color: "#c40000" }}>
                Admin
              </Link>
            )}

            {/* Signed-in indicator + Logout */}
            {email ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{email}</div>
                <LogoutButton />
              </div>
            ) : (
              <Link href="/login" style={{ fontWeight: 700 }}>
                Log in
              </Link>
            )}

            {/* 👇 BUILD STAMP */}
            <div style={{ fontSize: 12, opacity: 0.6 }}>build: test-2</div>
          </nav>
        </header>

        <main>{children}</main>
      </body>
    </html>
  );
}