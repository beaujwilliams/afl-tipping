"use client";

import "./globals.css";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import Link from "next/link";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabaseBrowser.auth.getUser();
      setEmail(data.user?.email ?? null);
    })();
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
          }}
        >
          <div style={{ fontWeight: 800 }}>
            <Link href="/" style={{ textDecoration: "none", color: "black" }}>
              Needlessly Complicated AFL Tipping
            </Link>
          </div>

          <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
            <Link href="/leaderboard/2026">Leaderboard</Link>

            {isAdmin && (
              <Link
                href="/admin"
                style={{
                  fontWeight: 700,
                  color: "#c40000",
                }}
              >
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