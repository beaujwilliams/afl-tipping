import type { Metadata } from "next";
import "./globals.css";
import { ChatActivityProvider } from "@/components/ChatActivityProvider";
import AppLayoutChrome from "@/components/AppLayoutChrome";
import { ToastProvider } from "@/components/ToastProvider";
import { createClient, createServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Complicated Tips",
  description: "Needlessly Complicated AFL Tipping picks, results, leaderboard, and chat.",
  applicationName: "Complicated Tips",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

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
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "var(--background)",
          color: "var(--foreground)",
          fontFamily: "var(--font-sans)",
        }}
      >
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
