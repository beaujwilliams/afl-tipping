"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

type ChatActivityContextValue = {
  unreadChat: number;
  unreadMentions: number;
  unreadAnnouncements: number;
  unreadLeaderboardInvites: number;
};

const ChatActivityContext = createContext<ChatActivityContextValue | null>(null);

function getLastChatSeenMs() {
  if (typeof window === "undefined") return 0;
  const v = window.localStorage.getItem("chat_last_seen_ms");
  return v ? Number(v) || 0 : 0;
}

function markChatSeenNow() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("chat_last_seen_ms", String(Date.now()));
}

function getLastAnnouncementsSeenMs() {
  if (typeof window === "undefined") return 0;
  const v = window.localStorage.getItem("announcements_last_seen_ms");
  return v ? Number(v) || 0 : 0;
}

function markAnnouncementsSeenNow() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("announcements_last_seen_ms", String(Date.now()));
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message || "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export function ChatActivityProvider({
  children,
  initialAuthenticated = false,
}: {
  children: React.ReactNode;
  initialAuthenticated?: boolean;
}) {
  const pathname = usePathname();
  const viewingChat = pathname?.startsWith("/chat") ?? false;
  const viewingAnnouncements = pathname?.startsWith("/announcements") ?? false;
  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadMentions, setUnreadMentions] = useState(0);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [unreadLeaderboardInvites, setUnreadLeaderboardInvites] = useState(0);
  const [sessionState, setSessionState] = useState<{
    accessToken: string;
    userId: string;
  } | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  });

  useEffect(() => {
    let mounted = true;

    async function syncSession() {
      if (!initialAuthenticated) {
        if (mounted) {
          setSessionState(null);
          setUnreadChat(0);
          setUnreadMentions(0);
          setUnreadAnnouncements(0);
          setUnreadLeaderboardInvites(0);
        }
        return;
      }

      const { data } = await supabaseBrowser.auth.getSession();
      if (!mounted) return;
      if (!data.session) {
        setSessionState(null);
        setUnreadChat(0);
        setUnreadMentions(0);
        setUnreadAnnouncements(0);
        setUnreadLeaderboardInvites(0);
        return;
      }

      setSessionState({
        accessToken: data.session.access_token,
        userId: data.session.user.id,
      });
    }

    void syncSession();

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (!session) {
        setSessionState(null);
        setUnreadChat(0);
        setUnreadMentions(0);
        setUnreadAnnouncements(0);
        setUnreadLeaderboardInvites(0);
        return;
      }
      setSessionState({
        accessToken: session.access_token,
        userId: session.user.id,
      });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [initialAuthenticated]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };

    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    async function refreshChatActivity() {
      if (!sessionState) {
        setUnreadChat(0);
        setUnreadMentions(0);
        setUnreadAnnouncements(0);
        setUnreadLeaderboardInvites(0);
        return;
      }

      const lastSeen = getLastChatSeenMs();
      const sinceIso = new Date(lastSeen).toISOString();

      const { count, error } = await supabaseBrowser
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .gt("created_at", sinceIso);

      if (!error) {
        setUnreadChat(count ?? 0);
      }

      const { count: mentionCount, error: mentionErr } = await supabaseBrowser
        .from("chat_message_mentions")
        .select("id", { count: "exact", head: true })
        .eq("mentioned_user_id", sessionState.userId)
        .gt("created_at", sinceIso);

      if (mentionErr) {
        if (isMissingRelationError(mentionErr.message, "chat_message_mentions")) {
          setUnreadMentions(0);
        }
      } else {
        setUnreadMentions(mentionCount ?? 0);
      }

      const lastAnnouncementsSeenMs = getLastAnnouncementsSeenMs();
      try {
        const announcementsRes = await fetch("/api/announcements", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${sessionState.accessToken}`,
          },
        });
        const announcementsJson = (await announcementsRes
          .json()
          .catch(() => null)) as {
          ok?: boolean;
          rows?: Array<{ published_at_utc?: string | null; created_at?: string | null }>;
        } | null;

        if (!announcementsRes.ok || !announcementsJson?.ok || !Array.isArray(announcementsJson.rows)) {
          setUnreadAnnouncements(0);
        } else {
          let unread = 0;
          announcementsJson.rows.forEach((row) => {
            const ts = new Date(String(row.published_at_utc ?? row.created_at ?? "")).getTime();
            if (Number.isFinite(ts) && ts > lastAnnouncementsSeenMs) unread += 1;
          });
          setUnreadAnnouncements(unread);
        }
      } catch {
        setUnreadAnnouncements(0);
      }

      try {
        const invitesRes = await fetch("/api/leaderboard-group-invites", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${sessionState.accessToken}`,
          },
        });
        const invitesJson = (await invitesRes.json().catch(() => null)) as
          | { ok?: boolean; pending_count?: number }
          | null;
        if (!invitesRes.ok || !invitesJson?.ok) {
          setUnreadLeaderboardInvites(0);
        } else {
          setUnreadLeaderboardInvites(Number(invitesJson.pending_count ?? 0));
        }
      } catch {
        setUnreadLeaderboardInvites(0);
      }
    }

    if (!pathname) return;

    if (viewingChat) {
      const previousSeen = getLastChatSeenMs();
      if (typeof window !== "undefined") {
        window.localStorage.setItem("chat_last_seen_snapshot_ms", String(previousSeen));
      }
      markChatSeenNow();
    }

    if (viewingAnnouncements) {
      markAnnouncementsSeenNow();
    }

    if (!sessionState) return;

    if (!isPageVisible) return;

    void refreshChatActivity();

    const t = setInterval(() => {
      void refreshChatActivity();
    }, 30000);
    return () => clearInterval(t);
  }, [isPageVisible, pathname, sessionState, viewingChat, viewingAnnouncements]);

  const value = useMemo(
    () => ({
      unreadChat: viewingChat ? 0 : unreadChat,
      unreadMentions: viewingChat ? 0 : unreadMentions,
      unreadAnnouncements: viewingAnnouncements ? 0 : unreadAnnouncements,
      unreadLeaderboardInvites,
    }),
    [
      unreadChat,
      unreadMentions,
      unreadAnnouncements,
      unreadLeaderboardInvites,
      viewingChat,
      viewingAnnouncements,
    ]
  );

  return <ChatActivityContext.Provider value={value}>{children}</ChatActivityContext.Provider>;
}

export function useChatActivity() {
  const value = useContext(ChatActivityContext);
  if (!value) {
    throw new Error("useChatActivity must be used within ChatActivityProvider");
  }
  return value;
}
