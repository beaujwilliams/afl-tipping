"use client";

import "./globals.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import LogoutButton from "@/components/LogoutButton";

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
      <body className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
            <div className="font-extrabold">
              <Link
                href="/"
                className="no-underline text-zinc-900 dark:text-zinc-100"
              >
                Needlessly Complicated AFL Tipping
              </Link>
            </div>

            <nav className="flex flex-wrap items-center justify-end gap-4 text-sm">
              <Link
                href="/round/2026"
                className="text-zinc-800 hover:underline dark:text-zinc-200"
              >
                Rounds
              </Link>

              <Link
                href="/leaderboard/2026"
                className="text-zinc-800 hover:underline dark:text-zinc-200"
              >
                Leaderboard
              </Link>

              {isAdmin && (
                <Link
                  href="/admin"
                  className="font-extrabold text-red-700 hover:underline dark:text-red-400"
                >
                  Admin
                </Link>
              )}

              {email ? (
                <div className="flex items-center gap-2">
                  <div className="max-w-[220px] truncate text-xs text-zinc-600 dark:text-zinc-400">
                    {email}
                  </div>
                  <LogoutButton />
                </div>
              ) : (
                <Link
                  href="/login"
                  className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
                >
                  Log in
                </Link>
              )}

              <div className="text-xs text-zinc-500 dark:text-zinc-500">
                build: test-2
              </div>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}