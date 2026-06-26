import type { Metadata } from "next";
import { headers } from "next/headers";
import { Manrope } from "next/font/google";
import "./globals.css";
import { ChatActivityProvider } from "@/components/ChatActivityProvider";
import AppLayoutChrome from "@/components/AppLayoutChrome";
import { ToastProvider } from "@/components/ToastProvider";
import WebVitalsReporter from "@/components/WebVitalsReporter";
import { createClient, createServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Complicated Tips",
  description: "Needlessly Complicated AFL Tipping picks, results, leaderboard, and chat.",
  applicationName: "Complicated Tips",
};

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-manrope",
});

const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/next-season",
  "/info",
] as const;

function isPublicPath(pathname: string) {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = String(headerList.get("x-pathname") ?? "").trim();
  const publicPath = isPublicPath(pathname);

  let user: { id: string; email?: string | null } | null = null;
  if (!publicPath) {
    const authClient = await createClient();
    const {
      data: { user: loadedUser },
    } = await authClient.auth.getUser();
    user = loadedUser;
  }

  const usePublicShell = publicPath || (!user && pathname === "/");

  if (usePublicShell) {
    return (
      <html lang="en" className={manrope.variable}>
        <body
          style={{
            margin: 0,
            background: "var(--background)",
            color: "var(--foreground)",
            fontFamily: "var(--font-sans)",
          }}
        >
          <WebVitalsReporter />
          {children}
        </body>
      </html>
    );
  }

  let initialIsAdmin = false;
  if (user?.id) {
    const supabase = createServiceClient();
    const { data: adminMembership } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();

    initialIsAdmin = !!adminMembership;
  }

  return (
    <html lang="en" className={manrope.variable}>
      <body
        style={{
          margin: 0,
          background: "var(--background)",
          color: "var(--foreground)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <WebVitalsReporter />
        <ToastProvider>
          <ChatActivityProvider initialAuthenticated={!!user}>
            <AppLayoutChrome
              initialEmail={user?.email ?? null}
              initialIsAdmin={initialIsAdmin}
            >
              {children}
            </AppLayoutChrome>
          </ChatActivityProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
