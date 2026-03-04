"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";

type MsgRow = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
};

type ReactionRow = {
  message_id: string;
  user_id: string;
  emoji: string;
};

const REACTIONS = ["👍", "😂", "😭", "❤️", "🔥", "😮"] as const;

function fmtMelbourne(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function ChatPage() {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [nameByUserId, setNameByUserId] = useState<Record<string, string>>({});
  const [reactions, setReactions] = useState<ReactionRow[]>([]);

  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const refreshTimer = useRef<any>(null);

  async function ensureSession() {
    const { data } = await supabaseBrowser.auth.getSession();
    if (!data.session) {
      window.location.href = "/login";
      return;
    }
    setUserId(data.session.user.id);
    setReady(true);
  }

  async function loadRecent() {
    setMsg("");

    const { data: rows, error } = await supabaseBrowser
      .from("chat_messages")
      .select("id, user_id, body, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      setMsg(error.message);
      return;
    }

    const list = (rows ?? []) as MsgRow[];
    const asc = [...list].reverse();
    setMessages(asc);

    const userIds = Array.from(new Set(asc.map((m) => m.user_id)));
    if (userIds.length) {
      // Pull display names from your profiles table
      const { data: profs } = await supabaseBrowser.from("profiles").select("id, display_name").in("id", userIds);

      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => {
        const name = (p.display_name ?? "").trim();
        if (name) map[String(p.id)] = name;
      });

      setNameByUserId((prev) => ({ ...prev, ...map }));
    }

    const msgIds = asc.map((m) => m.id);
    if (msgIds.length) {
      const { data: rs } = await supabaseBrowser
        .from("chat_reactions")
        .select("message_id, user_id, emoji")
        .in("message_id", msgIds);

      setReactions((rs ?? []) as ReactionRow[]);
    }
  }

  function scheduleRefresh() {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(async () => {
      refreshTimer.current = null;
      await loadRecent();
    }, 400);
  }

  useEffect(() => {
    ensureSession();
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadRecent();
  }, [ready]);

  // Realtime: refresh on inserts/deletes/reactions
  useEffect(() => {
    if (!ready) return;

    const channel = supabaseBrowser
      .channel("public-chat")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages" },
        () => scheduleRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_reactions" },
        () => scheduleRefresh()
      )
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Auto-scroll to bottom when new messages load
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const reactionsByMessage = useMemo(() => {
    const out: Record<
      string,
      { counts: Record<string, number>; mine: Record<string, boolean> }
    > = {};

    for (const r of reactions) {
      if (!out[r.message_id]) out[r.message_id] = { counts: {}, mine: {} };
      out[r.message_id].counts[r.emoji] = (out[r.message_id].counts[r.emoji] ?? 0) + 1;
      if (userId && r.user_id === userId) out[r.message_id].mine[r.emoji] = true;
    }
    return out;
  }, [reactions, userId]);

  async function send() {
    const body = text.trim();
    if (!body || !userId) return;

    setSending(true);
    setMsg("");

    const { error } = await supabaseBrowser.from("chat_messages").insert({
      user_id: userId,
      body: body.slice(0, 500),
    });

    setSending(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setText("");
    // realtime will refresh; but this feels snappier:
    scheduleRefresh();
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!userId) return;

    const mine = reactionsByMessage[messageId]?.mine?.[emoji] ?? false;

    if (mine) {
      await supabaseBrowser
        .from("chat_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", userId)
        .eq("emoji", emoji);
    } else {
      await supabaseBrowser.from("chat_reactions").insert({
        message_id: messageId,
        user_id: userId,
        emoji,
      });
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Public Chat</h1>
        <Link href="/round/2026" style={{ opacity: 0.8 }}>
          ← Back to rounds
        </Link>
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.04)",
          minHeight: 420,
        }}
      >
        {msg && <div style={{ marginBottom: 10, color: "crimson" }}>{msg}</div>}

        <div style={{ display: "grid", gap: 12 }}>
          {messages.map((m) => {
            const who = nameByUserId[m.user_id] || "Anonymous tipster";
            const r = reactionsByMessage[m.id]?.counts ?? {};
            const mine = reactionsByMessage[m.id]?.mine ?? {};

            return (
              <div key={m.id} style={{ paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, opacity: 0.85 }}>
                  <div style={{ fontWeight: 800 }}>{who}</div>
                  <div style={{ fontSize: 12 }}>{fmtMelbourne(m.created_at)}</div>
                </div>

                <div style={{ marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.35 }}>
                  {m.body}
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {REACTIONS.map((e) => (
                    <button
                      key={e}
                      onClick={() => toggleReaction(m.id, e)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: mine[e] ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                        color: "var(--foreground)",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                      aria-label={`React ${e}`}
                      type="button"
                    >
                      {e} {r[e] ? <span style={{ opacity: 0.85 }}>{r[e]}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div ref={bottomRef} />
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say something…"
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--foreground)",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!sending) send();
            }
          }}
        />
        <button
          onClick={send}
          disabled={sending}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.14)",
            background: sending ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)",
            color: "var(--foreground)",
            fontWeight: 900,
            cursor: sending ? "not-allowed" : "pointer",
            minWidth: 96,
          }}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        Slow mode: 1 message / 3 seconds. Messages auto-delete after 30 days.
      </div>
    </main>
  );
}