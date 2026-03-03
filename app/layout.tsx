"use client";

import "./globals.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import LogoutButton from "@/components/LogoutButton";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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

  // Close menu if you log out / switch users
  useEffect(() => {
    setMenuOpen(false);
  }, [email]);

  const isAdmin = (email ?? "").toLowerCase() === ADMIN_EMAIL;

  // Build stamp (Vercel -> short commit sha if available)
  const buildStamp = useMemo(() => {
    const sha =
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ||
      "";
    if (!sha) return "prod";
    return sha.slice(0, 7);
  }, []);

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <>
      <Link
        href="/round/2026"
        onClick={onClick}
        className="text-zinc-800 hover:underline dark:text-zinc-200"
      >
        Rounds
      </Link>

      <Link
        href="/leaderboard/2026"
        onClick={onClick}
        className="text-zinc-800 hover:underline dark:text-zinc-200"
      >
        Leaderboard
      </Link>

      {isAdmin && (
        <Link
          href="/admin"
          onClick={onClick}
          className="font-extrabold text-red-700 hover:underline dark:text-red-400"
        >
          Admin
        </Link>
      )}
    </>
  );

  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="min-w-0 font-extrabold">
              <Link
                href="/"
                className="block truncate no-underline text-zinc-900 dark:text-zinc-100"
              >
                Needlessly Complicated AFL Tipping
              </Link>
            </div>

            {/* Desktop nav */}
            <nav className="hidden items-center justify-end gap-4 text-sm md:flex">
              <NavLinks />
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

              {/* Build stamp (hide if you want later) */}
              <div className="text-xs text-zinc-500 dark:text-zinc-500">
                build: {buildStamp}
              </div>
            </nav>

            {/* Mobile menu button */}
            <button
              type="button"
              className="md:hidden rounded-xl border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label="Toggle menu"
            >
              {menuOpen ? "✕" : "☰"}
            </button>
          </div>

          {/* Mobile menu panel */}
          {menuOpen && (
            <div className="mx-auto mt-3 max-w-5xl md:hidden">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex flex-col gap-3 text-sm">
                  <NavLinks onClick={() => setMenuOpen(false)} />

                  <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

                  {email ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-400">
                        {email}
                      </div>
                      <LogoutButton />
                    </div>
                  ) : (
                    <Link
                      href="/login"
                      onClick={() => setMenuOpen(false)}
                      className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
                    >
                      Log in
                    </Link>
                  )}

                  <div className="text-xs text-zinc-500 dark:text-zinc-500">
                    build: {buildStamp}
                  </div>
                </div>
              </div>
            </div>
          )}
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}