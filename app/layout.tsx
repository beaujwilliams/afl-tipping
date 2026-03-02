"use client";

import "./globals.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

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

    // initial
    load();

    // also react to auth changes (login/logout)
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange(() => {
      load();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isAdmin = email === "beau.j.williams@gmail.com";

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
          }}
        >
          <div style={{ fontWeight: 800 }}>
            <Link href="/" style={{ textDecoration: "none", color: "black" }}>
              Needlessly Complicated AFL Tipping
            </Link>
          </div>

          <nav style={{ display: "flex", gap: 16, fontSize: 14, alignItems: "center" }}>
            <Link href="/round/2026">Rounds</Link>
            <Link href="/leaderboard/2026">Leaderboard</Link>

            {isAdmin && (
              <Link href="/admin" style={{ fontWeight: 800, color: "#c40000" }}>
                Admin
              </Link>
            )}
          </nav>
        </header>

        <main>{children}</main>
      </body>
    </html>
  );
}