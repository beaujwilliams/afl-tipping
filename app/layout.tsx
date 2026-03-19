import type { Metadata } from "next";
import "./globals.css";
import { ChatActivityProvider } from "@/components/ChatActivityProvider";
import AppLayoutChrome from "@/components/AppLayoutChrome";

export const metadata: Metadata = {
  title: "Complicated Tips",
  description: "Needlessly Complicated AFL Tipping picks, results, leaderboard, and chat.",
  applicationName: "Complicated Tips",
};

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
          <AppLayoutChrome>{children}</AppLayoutChrome>
        </ChatActivityProvider>
      </body>
    </html>
  );
}
