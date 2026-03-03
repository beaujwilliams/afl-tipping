"use client";

import "./globals.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import LogoutButton from "@/components/LogoutButton";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";

// Set this in Vercel env vars (works client-side because it's NEXT_PUBLIC_)
const BUILD_LABEL = process.env.NEXT_PUBLIC_BUILD_LABEL || "";

function NavLink({
  href,
  children,
  active,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={[
        "rounded-xl px-3 py-2 text-sm font-semibold",
        "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900",
        active ? "bg-zinc-100 dark:bg-zinc-900" : "",
        className,
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const isAdmin = useMemo(
    () => (email ?? "").toLowerCase() === ADMIN_EMAIL.toLowerCase(),
    [email]
  );

  // close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const roundsHref = "/round/2026";
  const leaderboardHref = "/leaderboard/2026";
  const adminHref = "/admin";

  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {/* Top bar */}
        <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <Link
              href="/"
              className="text-base font-extrabold leading-tight text-zinc-900 dark:text-zinc-100"
            >
              Needlessly Complicated AFL Tipping
            </Link>

            {/* Desktop nav */}
            <nav className="hidden items-center gap-2 md:flex">
              <NavLink href={roundsHref} active={pathname?.startsWith("/round/")}>
                Rounds
              </NavLink>
              <NavLink
                href={leaderboardHref}
                active={pathname?.startsWith("/leaderboard/")}
              >
                Leaderboard
              </NavLink>
              {isAdmin && (
                <NavLink
                  href={adminHref}
                  active={pathname?.startsWith("/admin")}
                  className="text-red-700 dark:text-red-400"
                >
                  Admin
                </NavLink>
              )}

              <div className="ml-2 flex items-center gap-2">
                {email ? (
                  <>
                    <div className="max-w-[220px] truncate text-xs text-zinc-600 dark:text-zinc-400">
                      {email}
                    </div>
                    <LogoutButton />
                  </>
                ) : (
                  <NavLink href="/login" active={pathname === "/login"}>
                    Log in
                  </NavLink>
                )}

                {BUILD_LABEL ? (
                  <div className="ml-2 text-xs text-zinc-500">{BUILD_LABEL}</div>
                ) : null}
              </div>
            </nav>

            {/* Mobile menu button */}
            <button
              className="md:hidden rounded-xl border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
            >
              Menu
            </button>
          </div>

          {/* Mobile menu panel */}
          {menuOpen && (
            <div className="md:hidden border-t border-zinc-200 dark:border-zinc-800">
              <div className="mx-auto max-w-5xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold">Menu</div>
                  <button
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    onClick={() => setMenuOpen(false)}
                    aria-label="Close menu"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-3 grid gap-2">
                  <NavLink href={roundsHref} active={pathname?.startsWith("/round/")}>
                    Rounds
                  </NavLink>
                  <NavLink
                    href={leaderboardHref}
                    active={pathname?.startsWith("/leaderboard/")}
                  >
                    Leaderboard
                  </NavLink>
                  {isAdmin && (
                    <NavLink
                      href={adminHref}
                      active={pathname?.startsWith("/admin")}
                      className="text-red-700 dark:text-red-400"
                    >
                      Admin
                    </NavLink>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                  {email ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                          Signed in as
                        </div>
                        <div className="truncate text-sm font-semibold">{email}</div>
                      </div>
                      <LogoutButton />
                    </div>
                  ) : (
                    <NavLink href="/login" active={pathname === "/login"}>
                      Log in
                    </NavLink>
                  )}

                  {BUILD_LABEL ? (
                    <div className="mt-2 text-xs text-zinc-500">{BUILD_LABEL}</div>
                  ) : null}
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