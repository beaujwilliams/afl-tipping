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

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message || "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export function ChatActivityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const viewingChat = pathname?.startsWith("/chat") ?? false;
  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadMentions, setUnreadMentions] = useState(0);
  const [authTick, setAuthTick] = useState(0);

  useEffect(() => {
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange(() => {
      setAuthTick((prev) => prev + 1);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    async function refreshChatActivity() {
      const { data } = await supabaseBrowser.auth.getSession();
      if (!data.session) {
        setUnreadChat(0);
        setUnreadMentions(0);
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
        .eq("mentioned_user_id", data.session.user.id)
        .gt("created_at", sinceIso);

      if (mentionErr) {
        if (isMissingRelationError(mentionErr.message, "chat_message_mentions")) {
          setUnreadMentions(0);
        }
        return;
      }

      setUnreadMentions(mentionCount ?? 0);
    }

    if (!pathname) return;

    if (viewingChat) {
      const previousSeen = getLastChatSeenMs();
      if (typeof window !== "undefined") {
        window.localStorage.setItem("chat_last_seen_snapshot_ms", String(previousSeen));
      }
      markChatSeenNow();
      return;
    }

    refreshChatActivity();

    const t = setInterval(refreshChatActivity, 30000);
    return () => clearInterval(t);
  }, [authTick, pathname, viewingChat]);

  const value = useMemo(
    () => ({
      unreadChat: viewingChat ? 0 : unreadChat,
      unreadMentions: viewingChat ? 0 : unreadMentions,
    }),
    [unreadChat, unreadMentions, viewingChat]
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
