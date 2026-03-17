"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ReactionPill } from "@/components/ReactionPill";
import { UnpaidTag } from "@/components/UnpaidTag";
import { ChampionCrown } from "@/components/ChampionCrown";

type MsgRow = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  reply_to_message_id?: string | null;
  edited_at?: string | null;
};

type ReactionRow = {
  message_id: string;
  user_id: string;
  emoji: string;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  favorite_team?: string | null;
  username?: string | null;
};

type MembershipRoleRow = {
  role: string | null;
};

type MembershipPaymentRow = {
  user_id: string;
  payment_status?: string | null;
};

type MembershipUserRow = {
  user_id: string;
};

type ReigningChampionResponse = {
  ok?: boolean;
  reigning_champion_user_id?: string | null;
};

type ComposerMentionStatus = {
  alias: string;
  valid: boolean;
  displayName: string | null;
};

const REACTIONS = ["👍", "😂", "😭", "❤️", "🔥", "😮"] as const;
const CURRENT_SEASON = 2026;
const EDIT_WINDOW_MS = 5 * 60 * 1000;
const CHAT_MAX_CHARS = 3000;

function isAdminRole(role: string | null | undefined) {
  const r = String(role ?? "")
    .trim()
    .toLowerCase();
  return r === "owner" || r === "admin";
}

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

function isMissingColumnError(message: string, columnName: string) {
  const m = String(message || "").toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message || "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

function normalizePaymentStatus(status: string | null | undefined) {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (s === "paid" || s === "pending" || s === "waived") return s;
  return null;
}

function withinEditWindow(iso: string) {
  const createdAtMs = new Date(iso).getTime();
  if (Number.isNaN(createdAtMs)) return false;
  return Date.now() - createdAtMs <= EDIT_WINDOW_MS;
}

function snippet(text: string, max = 110) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function extractMentionAliases(text: string) {
  const aliases = new Set<string>();
  const regex = /@([a-z0-9_]{2,30})/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    aliases.add(match[1].toLowerCase());
  }
  return Array.from(aliases);
}

function displayNameMentionAliases(displayName: string | null | undefined) {
  const clean = String(displayName ?? "")
    .trim()
    .toLowerCase();
  if (!clean) return [];

  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];

  const aliases = new Set<string>();
  aliases.add(parts[0]);
  aliases.add(parts.join("_"));
  aliases.add(parts.join(""));

  return Array.from(aliases).filter((alias) => alias.length >= 2 && alias.length <= 30);
}

function bodyMentionsAnyAlias(text: string, aliases: Set<string>) {
  if (!aliases.size) return false;
  const found = extractMentionAliases(text);
  return found.some((alias) => aliases.has(alias));
}

export default function ChatPage() {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [quotedById, setQuotedById] = useState<Record<string, MsgRow>>({});
  const [nameByUserId, setNameByUserId] = useState<Record<string, string>>({});
  const [favoriteTeamByUserId, setFavoriteTeamByUserId] = useState<Record<string, string>>({});
  const [usernameByUserId, setUsernameByUserId] = useState<Record<string, string>>({});
  const [mentionableByAlias, setMentionableByAlias] = useState<Record<string, string>>({});
  const [paymentStatusByUserId, setPaymentStatusByUserId] = useState<Record<string, string | null>>({});
  const [reigningChampionUserId, setReigningChampionUserId] = useState<string | null>(null);
  const [reactions, setReactions] = useState<ReactionRow[]>([]);

  const [text, setText] = useState("");
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [msg, setMsg] = useState<string>("");
  const [sending, setSending] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // --- scroll lock + unread markers + new message button ---
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);

  const [newCount, setNewCount] = useState(0);

  const [unreadBoundaryMs, setUnreadBoundaryMs] = useState(0);
  const unreadBoundaryMsRef = useRef(0);

  const initialLoadDoneRef = useRef(false);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const messageById = useMemo(() => {
    const out: Record<string, MsgRow> = { ...quotedById };
    for (const m of messages) out[m.id] = m;
    return out;
  }, [messages, quotedById]);

  const myUsername = userId ? usernameByUserId[userId] ?? "" : "";
  const myUsernameLower = myUsername.toLowerCase();
  const myDisplayName = userId ? nameByUserId[userId] ?? "" : "";
  const myMentionAliases = useMemo(() => {
    const aliases = new Set<string>();
    if (myUsernameLower) aliases.add(myUsernameLower);
    for (const alias of displayNameMentionAliases(myDisplayName)) aliases.add(alias);
    return aliases;
  }, [myUsernameLower, myDisplayName]);

  const composerMentionStatuses = useMemo<ComposerMentionStatus[]>(() => {
    const aliases = extractMentionAliases(text);
    return aliases.map((alias) => {
      const mentionedUserId = mentionableByAlias[alias] ?? null;
      const displayName = mentionedUserId ? nameByUserId[mentionedUserId] ?? null : null;
      return {
        alias,
        valid: !!mentionedUserId,
        displayName,
      };
    });
  }, [text, mentionableByAlias, nameByUserId]);

  const hasInvalidComposerMentions = useMemo(
    () => composerMentionStatuses.some((mention) => !mention.valid),
    [composerMentionStatuses]
  );

  const firstUnreadMessageId = useMemo(() => {
    if (!unreadBoundaryMs) return null;
    const first = messages.find((m) => {
      const t = new Date(m.created_at).getTime();
      return !Number.isNaN(t) && t > unreadBoundaryMs;
    });
    return first?.id ?? null;
  }, [messages, unreadBoundaryMs]);

  const unreadMentionCountInView = useMemo(() => {
    if (!myMentionAliases.size || !unreadBoundaryMs) return 0;
    let count = 0;
    for (const m of messages) {
      const t = new Date(m.created_at).getTime();
      if (Number.isNaN(t) || t <= unreadBoundaryMs) continue;
      if (bodyMentionsAnyAlias(m.body, myMentionAliases)) count += 1;
    }
    return count;
  }, [messages, myMentionAliases, unreadBoundaryMs]);

  const replyTarget = replyToMessageId ? messageById[replyToMessageId] ?? null : null;

  function scrollToTop(smooth = true) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    setNewCount(0);
  }

  function scrollToMessage(messageId: string, smooth = true) {
    const node = messageRefs.current[messageId];
    if (!node) return;
    node.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
    setNewCount(0);
  }

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;

    const threshold = 40; // px
    const isTop = el.scrollTop < threshold;

    setAtTop(isTop);
    atTopRef.current = isTop;

    if (isTop) setNewCount(0);
  }

  async function loadMentionDirectory(compId: string) {
    const { data: memberRows, error: memberErr } = await supabaseBrowser
      .from("memberships")
      .select("user_id")
      .eq("competition_id", compId);

    if (memberErr) return;

    const memberIds = Array.from(new Set(((memberRows ?? []) as MembershipUserRow[]).map((m) => String(m.user_id))));
    if (!memberIds.length) {
      setMentionableByAlias({});
      return;
    }

    const { data: profRows, error: profErr } = await supabaseBrowser
      .from("profiles")
      .select("id, display_name, username")
      .in("id", memberIds);

    let directoryRows: ProfileRow[] = [];
    if (profErr) {
      if (!isMissingColumnError(profErr.message, "username")) {
        return;
      }

      const fallback = await supabaseBrowser.from("profiles").select("id, display_name").in("id", memberIds);
      if (fallback.error) return;
      directoryRows = ((fallback.data ?? []) as ProfileRow[]).map((p) => ({
        ...p,
        username: null,
      }));
    } else {
      directoryRows = (profRows ?? []) as ProfileRow[];
    }

    const usernamesMap: Record<string, string> = {};
    const byAlias: Record<string, string> = {};
    const namesMap: Record<string, string> = {};
    const ambiguousAliases = new Set<string>();

    function addAlias(alias: string, uid: string) {
      const key = String(alias ?? "")
        .trim()
        .toLowerCase();
      if (key.length < 2 || key.length > 30) return;
      if (ambiguousAliases.has(key)) return;
      const existing = byAlias[key];
      if (!existing) {
        byAlias[key] = uid;
        return;
      }
      if (existing !== uid) {
        delete byAlias[key];
        ambiguousAliases.add(key);
      }
    }

    directoryRows.forEach((p) => {
      const uid = String(p.id);
      const displayName = String(p.display_name ?? "").trim();
      const username = String(p.username ?? "").trim().toLowerCase();

      if (displayName) namesMap[uid] = displayName;
      if (username) {
        usernamesMap[uid] = username;
        addAlias(username, uid);
      }
      for (const alias of displayNameMentionAliases(displayName)) addAlias(alias, uid);
    });

    setNameByUserId((prev) => ({ ...prev, ...namesMap }));
    setUsernameByUserId((prev) => ({ ...prev, ...usernamesMap }));
    setMentionableByAlias(byAlias);
  }

  async function ensureSession() {
    const { data: s } = await supabaseBrowser.auth.getSession();
    if (!s.session) {
      window.location.href = "/login";
      return;
    }

    if (typeof window !== "undefined") {
      const snapshot = Number(window.localStorage.getItem("chat_last_seen_snapshot_ms") || "0") || 0;
      const fallback = Number(window.localStorage.getItem("chat_last_seen_ms") || "0") || 0;
      const boundary = snapshot || fallback || 0;
      unreadBoundaryMsRef.current = boundary;
      setUnreadBoundaryMs(boundary);
    }

    const currentUserId = s.session.user.id;
    setUserId(currentUserId);

    const { data: comp } = await supabaseBrowser
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (comp?.id) {
      const compId = String(comp.id);
      setCompetitionId(compId);

      const { data: membership } = await supabaseBrowser
        .from("memberships")
        .select("role")
        .eq("competition_id", comp.id)
        .eq("user_id", currentUserId)
        .maybeSingle();

      const role = (membership as MembershipRoleRow | null)?.role ?? null;
      setIsAdmin(isAdminRole(role));

      await loadMentionDirectory(compId);
    } else {
      setCompetitionId(null);
      setIsAdmin(false);
    }

    setReady(true);
  }

  async function loadRecent() {
    setMsg("");

    let list: MsgRow[] = [];

    const withReplyAndEdit = await supabaseBrowser
      .from("chat_messages")
      .select("id, user_id, body, created_at, reply_to_message_id, edited_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (withReplyAndEdit.error) {
      const fallbackAllowed =
        isMissingColumnError(withReplyAndEdit.error.message, "reply_to_message_id") ||
        isMissingColumnError(withReplyAndEdit.error.message, "edited_at");

      if (!fallbackAllowed) {
        setMsg(withReplyAndEdit.error.message);
        return;
      }

      const fallback = await supabaseBrowser
        .from("chat_messages")
        .select("id, user_id, body, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (fallback.error) {
        setMsg(fallback.error.message);
        return;
      }

      list = ((fallback.data ?? []) as MsgRow[]).map((m) => ({
        ...m,
        reply_to_message_id: null,
        edited_at: null,
      }));
    } else {
      list = (withReplyAndEdit.data ?? []) as MsgRow[];
    }

    const desc = [...list];

    // new message detection (for "New messages ↑" button)
    const prevKnown = knownIdsRef.current;
    let newlySeen = 0;
    for (const m of desc) {
      if (!prevKnown.has(m.id)) newlySeen += 1;
    }
    knownIdsRef.current = new Set(desc.map((m) => m.id));

    setMessages(desc);

    // Pull quoted parent messages not already in the latest 50.
    const quotedMap: Record<string, MsgRow> = {};
    desc.forEach((m) => {
      quotedMap[m.id] = m;
    });

    const replyIds = Array.from(
      new Set(
        desc
          .map((m) => m.reply_to_message_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );

    const missingReplyIds = replyIds.filter((id) => !quotedMap[id]);
    if (missingReplyIds.length) {
      const { data: quotedRows } = await supabaseBrowser
        .from("chat_messages")
        .select("id, user_id, body, created_at")
        .in("id", missingReplyIds);

      ((quotedRows ?? []) as MsgRow[]).forEach((m) => {
        quotedMap[m.id] = {
          ...m,
          reply_to_message_id: null,
          edited_at: null,
        };
      });
    }

    setQuotedById(quotedMap);

    // Pull reactions for these messages
    const msgIds = desc.map((m) => m.id);
    let reactionList: ReactionRow[] = [];
    if (msgIds.length) {
      const { data: rs } = await supabaseBrowser.from("chat_reactions").select("message_id, user_id, emoji").in(
        "message_id",
        msgIds
      );

      reactionList = (rs ?? []) as ReactionRow[];
      setReactions(reactionList);
    } else {
      setReactions([]);
    }

    // Pull display names for message authors + reactors + quoted authors.
    const nameUserIds = new Set<string>(desc.map((m) => m.user_id));
    reactionList.forEach((r) => nameUserIds.add(r.user_id));
    Object.values(quotedMap).forEach((m) => nameUserIds.add(m.user_id));

    const userIds = Array.from(nameUserIds);

    if (userIds.length) {
      let profRows: ProfileRow[] = [];

      const withAll = await supabaseBrowser
        .from("profiles")
        .select("id, display_name, favorite_team, username")
        .in("id", userIds);

      if (withAll.error) {
        const withFavorite = await supabaseBrowser
          .from("profiles")
          .select("id, display_name, favorite_team")
          .in("id", userIds);

        if (withFavorite.error) {
          const fallback = await supabaseBrowser.from("profiles").select("id, display_name").in("id", userIds);
          profRows = (fallback.data as ProfileRow[] | null) ?? [];
        } else {
          profRows = (withFavorite.data as ProfileRow[] | null) ?? [];
        }
      } else {
        profRows = (withAll.data as ProfileRow[] | null) ?? [];
      }

      const nameMap: Record<string, string> = {};
      const teamMap: Record<string, string> = {};
      const usernameMap: Record<string, string> = {};

      profRows.forEach((p) => {
        const uid = String(p.id);
        const name = (p.display_name ?? "").trim();
        const team = (p.favorite_team ?? "").trim();
        const username = (p.username ?? "").trim().toLowerCase();
        if (name) nameMap[uid] = name;
        if (team) teamMap[uid] = team;
        if (username) {
          usernameMap[uid] = username;
        }
      });

      setNameByUserId((prev) => ({ ...prev, ...nameMap }));
      setFavoriteTeamByUserId((prev) => ({ ...prev, ...teamMap }));
      setUsernameByUserId((prev) => ({ ...prev, ...usernameMap }));

      if (competitionId) {
        const paymentMap: Record<string, string | null> = {};

        const withPayment = await supabaseBrowser
          .from("memberships")
          .select("user_id, payment_status")
          .eq("competition_id", competitionId)
          .in("user_id", userIds);

        if (withPayment.error && isMissingColumnError(withPayment.error.message, "payment_status")) {
          const fallback = await supabaseBrowser
            .from("memberships")
            .select("user_id")
            .eq("competition_id", competitionId)
            .in("user_id", userIds);

          (fallback.data as MembershipPaymentRow[] | null)?.forEach((m) => {
            paymentMap[String(m.user_id)] = null;
          });
        } else if (!withPayment.error) {
          (withPayment.data as MembershipPaymentRow[] | null)?.forEach((m) => {
            paymentMap[String(m.user_id)] = normalizePaymentStatus(m.payment_status ?? null);
          });
        }

        setPaymentStatusByUserId((prev) => ({ ...prev, ...paymentMap }));
      }
    }

    if (!initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true;
      const firstUnreadId = desc.find((m) => {
        const t = new Date(m.created_at).getTime();
        return !Number.isNaN(t) && t > unreadBoundaryMsRef.current;
      })?.id;

      setTimeout(() => {
        if (firstUnreadId) {
          scrollToMessage(firstUnreadId, false);
        } else {
          scrollToTop(false);
        }
      }, 0);
      return;
    }

    // Auto-scroll behavior:
    // - If you're at top, stay on latest messages
    // - If you're scrolled down, increment the counter and show button
    if (newlySeen > 0) {
      if (atTopRef.current) {
        // let the DOM paint first
        setTimeout(() => scrollToTop(false), 0);
      } else {
        setNewCount((c) => c + newlySeen);
      }
    }
  }

  function scheduleRefresh() {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(async () => {
      refreshTimer.current = null;
      await loadRecent();
    }, 350);
  }

  async function syncMentionsForMessage(messageId: string, body: string) {
    const aliases = extractMentionAliases(body);

    const { error: clearErr } = await supabaseBrowser
      .from("chat_message_mentions")
      .delete()
      .eq("message_id", messageId);

    if (clearErr) {
      if (isMissingRelationError(clearErr.message, "chat_message_mentions")) return;
      console.warn("chat_message_mentions clear failed", clearErr.message);
      return;
    }

    if (!aliases.length) return;

    const seen = new Set<string>();
    const targets = aliases
      .map((alias) => ({ alias, mentioned_user_id: mentionableByAlias[alias] }))
      .filter((v): v is { alias: string; mentioned_user_id: string } => typeof v.mentioned_user_id === "string")
      .filter((v) => {
        const key = `${v.mentioned_user_id}:${v.alias}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (!targets.length) return;

    const payload = targets.map((t) => ({
      message_id: messageId,
      mentioned_user_id: t.mentioned_user_id,
      mentioned_username: t.alias,
    }));

    const { error: insertErr } = await supabaseBrowser.from("chat_message_mentions").insert(payload);
    if (insertErr && !isMissingRelationError(insertErr.message, "chat_message_mentions")) {
      console.warn("chat_message_mentions insert failed", insertErr.message);
    }
  }

  function renderBodyWithMentions(body: string): ReactNode {
    const regex = /@([a-z0-9_]{2,30})/gi;
    const parts: ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(body)) !== null) {
      const full = match[0];
      const username = match[1].toLowerCase();
      const idx = match.index;

      if (idx > last) {
        parts.push(body.slice(last, idx));
      }

      const isMe = myMentionAliases.has(username);
      parts.push(
        <span
          key={`${idx}-${full}`}
          style={{
            borderRadius: 6,
            padding: "0 4px",
            fontWeight: 800,
            background: isMe ? "rgba(245, 158, 11, 0.22)" : "rgba(255,255,255,0.10)",
            color: isMe ? "rgb(180, 83, 9)" : "inherit",
          }}
        >
          {full}
        </span>
      );

      last = idx + full.length;
    }

    if (last < body.length) {
      parts.push(body.slice(last));
    }

    return parts;
  }

  useEffect(() => {
    ensureSession();
  }, []);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;

    el.style.height = "0px";
    const maxHeight = 180;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [text]);

  useEffect(() => {
    if (!competitionId) {
      setReigningChampionUserId(null);
      return;
    }

    let alive = true;

    (async () => {
      try {
        const res = await fetch(
          `/api/reigning-champion?competition_id=${encodeURIComponent(competitionId)}&season=${CURRENT_SEASON}`,
          { cache: "no-store" }
        );
        const json = (await res.json().catch(() => null)) as ReigningChampionResponse | null;
        if (!alive) return;

        if (!res.ok || !json?.ok) {
          setReigningChampionUserId(null);
          return;
        }

        setReigningChampionUserId(
          typeof json.reigning_champion_user_id === "string" ? json.reigning_champion_user_id : null
        );
      } catch {
        if (!alive) return;
        setReigningChampionUserId(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [competitionId]);

  useEffect(() => {
    if (!ready) return;
    initialLoadDoneRef.current = false;
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, competitionId]);

  // Realtime refresh
  useEffect(() => {
    if (!ready) return;

    const channel = supabaseBrowser
      .channel("public-chat")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, () => scheduleRefresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions" }, () => scheduleRefresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_message_mentions" }, () => scheduleRefresh())
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const reactionsByMessage = useMemo(() => {
    const out: Record<string, { counts: Record<string, number>; mine: Record<string, boolean> }> = {};
    for (const r of reactions) {
      if (!out[r.message_id]) out[r.message_id] = { counts: {}, mine: {} };
      out[r.message_id].counts[r.emoji] = (out[r.message_id].counts[r.emoji] ?? 0) + 1;
      if (userId && r.user_id === userId) out[r.message_id].mine[r.emoji] = true;
    }
    return out;
  }, [reactions, userId]);

  const reactionNamesByMessage = useMemo(() => {
    const out: Record<string, Record<string, string[]>> = {};
    const seen: Record<string, Record<string, Set<string>>> = {};

    for (const r of reactions) {
      if (!out[r.message_id]) out[r.message_id] = {};
      if (!seen[r.message_id]) seen[r.message_id] = {};
      if (!out[r.message_id][r.emoji]) out[r.message_id][r.emoji] = [];
      if (!seen[r.message_id][r.emoji]) seen[r.message_id][r.emoji] = new Set();

      const name = nameByUserId[r.user_id] ?? "Anonymous tipster";
      const crownedName = r.user_id === reigningChampionUserId ? `${name} 👑` : name;
      const paymentStatus = paymentStatusByUserId[r.user_id] ?? null;
      const display = paymentStatus === "pending" ? `${crownedName} (unpaid)` : crownedName;
      if (seen[r.message_id][r.emoji].has(display)) continue;

      seen[r.message_id][r.emoji].add(display);
      out[r.message_id][r.emoji].push(display);
    }

    return out;
  }, [reactions, nameByUserId, paymentStatusByUserId, reigningChampionUserId]);

  async function send() {
    const baseBody = text.trim();
    if (!baseBody || !userId) return;

    const body = baseBody.slice(0, CHAT_MAX_CHARS);

    setSending(true);
    setMsg("");

    let insertedMessageId: string | null = null;

    if (replyToMessageId) {
      const withReply = await supabaseBrowser
        .from("chat_messages")
        .insert({
          user_id: userId,
          body,
          reply_to_message_id: replyToMessageId,
        })
        .select("id")
        .single();

      if (withReply.error) {
        if (!isMissingColumnError(withReply.error.message, "reply_to_message_id")) {
          setSending(false);
          setMsg(withReply.error.message);
          return;
        }

        const fallback = await supabaseBrowser
          .from("chat_messages")
          .insert({ user_id: userId, body })
          .select("id")
          .single();

        if (fallback.error) {
          setSending(false);
          setMsg(fallback.error.message);
          return;
        }

        insertedMessageId = String(fallback.data?.id ?? "");
      } else {
        insertedMessageId = String(withReply.data?.id ?? "");
      }
    } else {
      const inserted = await supabaseBrowser
        .from("chat_messages")
        .insert({ user_id: userId, body })
        .select("id")
        .single();

      if (inserted.error) {
        setSending(false);
        setMsg(inserted.error.message);
        return;
      }

      insertedMessageId = String(inserted.data?.id ?? "");
    }

    setSending(false);

    if (insertedMessageId) {
      await syncMentionsForMessage(insertedMessageId, body);
    }

    setText("");
    setReplyToMessageId(null);
    // if you send, keep the latest messages in view
    setNewCount(0);
    scheduleRefresh();
    setTimeout(() => scrollToTop(true), 0);
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

  function startEdit(message: MsgRow) {
    setEditingMessageId(message.id);
    setEditText(message.body);
    setReplyToMessageId(null);
  }

  function cancelEdit() {
    setEditingMessageId(null);
    setEditText("");
  }

  async function saveEdit(message: MsgRow) {
    if (!userId) return;
    const nextBody = editText.trim().slice(0, CHAT_MAX_CHARS);
    if (!nextBody) return;

    setSavingEdit(true);
    setMsg("");

    const withEditedAt = await supabaseBrowser
      .from("chat_messages")
      .update({
        body: nextBody,
        edited_at: new Date().toISOString(),
      })
      .eq("id", message.id)
      .eq("user_id", userId);

    if (withEditedAt.error) {
      if (!isMissingColumnError(withEditedAt.error.message, "edited_at")) {
        setSavingEdit(false);
        setMsg(withEditedAt.error.message);
        return;
      }

      const fallback = await supabaseBrowser
        .from("chat_messages")
        .update({ body: nextBody })
        .eq("id", message.id)
        .eq("user_id", userId);

      if (fallback.error) {
        setSavingEdit(false);
        setMsg(fallback.error.message);
        return;
      }
    }

    await syncMentionsForMessage(message.id, nextBody);

    setSavingEdit(false);
    setEditingMessageId(null);
    setEditText("");
    scheduleRefresh();
  }

  async function deleteMessage(message: MsgRow) {
    if (!userId) return;

    const isOwner = message.user_id === userId;
    const ownerAllowed = isOwner && withinEditWindow(message.created_at);
    if (!isAdmin && !ownerAllowed) return;

    const ok = confirm("Delete this message? (Hard delete)");
    if (!ok) return;

    // delete reactions first (avoids FK issues if you don't have cascade)
    await supabaseBrowser.from("chat_reactions").delete().eq("message_id", message.id);

    const mentionDelete = await supabaseBrowser
      .from("chat_message_mentions")
      .delete()
      .eq("message_id", message.id);

    if (mentionDelete.error && !isMissingRelationError(mentionDelete.error.message, "chat_message_mentions")) {
      console.warn("chat_message_mentions delete failed", mentionDelete.error.message);
    }

    let del = supabaseBrowser.from("chat_messages").delete().eq("id", message.id);
    if (!isAdmin) {
      del = del.eq("user_id", userId);
    }

    const { error } = await del;
    if (error) {
      alert(error.message);
      return;
    }

    scheduleRefresh();
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
        }}
      >
        {msg && <div style={{ marginBottom: 10, color: "crimson" }}>{msg}</div>}

        <div
          style={{
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.78 }}>
            Mention people with @display-name or @username (for example @Jordan).
            {myUsername && ` Your username is @${myUsername}.`}
            {unreadMentionCountInView > 0 && (
              <span style={{ marginLeft: 8, color: "rgb(217, 119, 6)", fontWeight: 800 }}>
                {unreadMentionCountInView} unread mention{unreadMentionCountInView === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {firstUnreadMessageId && (
            <button
              onClick={() => scrollToMessage(firstUnreadMessageId, true)}
              type="button"
              style={{
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.08)",
                color: "var(--foreground)",
                borderRadius: 999,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Jump to first unread
            </button>
          )}
        </div>

        {/* Scrollable message area */}
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          style={{
            position: "relative",
            maxHeight: "60vh",
            overflowY: "auto",
            paddingRight: 6,
          }}
        >
          <div style={{ display: "grid", gap: 12 }}>
            {messages.map((m) => {
              const who = nameByUserId[m.user_id] || "Anonymous tipster";
              const team = favoriteTeamByUserId[m.user_id] ?? "";
              const paymentStatus = paymentStatusByUserId[m.user_id] ?? null;
              const r = reactionsByMessage[m.id]?.counts ?? {};
              const mine = reactionsByMessage[m.id]?.mine ?? {};
              const isOwner = !!userId && m.user_id === userId;
              const ownerWithinWindow = isOwner && withinEditWindow(m.created_at);
              const canEdit = !!ownerWithinWindow;
              const canDelete = !!isAdmin || !!ownerWithinWindow;
              const mentionsMe = bodyMentionsAnyAlias(m.body, myMentionAliases);
              const replySource =
                m.reply_to_message_id && typeof m.reply_to_message_id === "string"
                  ? messageById[m.reply_to_message_id] ?? null
                  : null;
              const replyName = replySource ? nameByUserId[replySource.user_id] ?? "Anonymous tipster" : "Message";
              const isEditing = editingMessageId === m.id;

              return (
                <div key={m.id}>
                  {firstUnreadMessageId === m.id && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 10,
                        position: "sticky",
                        top: 0,
                        zIndex: 1,
                        background: "var(--background)",
                        borderRadius: 10,
                        padding: "6px 8px",
                        border: "1px solid rgba(245, 158, 11, 0.40)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 900,
                          letterSpacing: 0.3,
                          color: "rgb(245, 158, 11)",
                          textTransform: "uppercase",
                        }}
                      >
                        Unread starts here
                      </span>
                    </div>
                  )}

                  <div
                    ref={(node) => {
                      messageRefs.current[m.id] = node;
                    }}
                    style={{
                      paddingBottom: 10,
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 8,
                      paddingLeft: 6,
                      paddingRight: 6,
                      background: mentionsMe ? "rgba(245, 158, 11, 0.10)" : "transparent",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, opacity: 0.9 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <ChampionCrown isChampion={m.user_id === reigningChampionUserId} />
                          <span>{who}</span>
                          <UnpaidTag paymentStatus={paymentStatus} />
                        </div>
                        {team && (
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              letterSpacing: 0.2,
                              padding: "3px 7px",
                              borderRadius: 999,
                              border: "1px solid rgba(255,255,255,0.22)",
                              background: "rgba(255,255,255,0.06)",
                              lineHeight: 1.1,
                            }}
                          >
                            {team}
                          </div>
                        )}
                        <div style={{ fontSize: 12, opacity: 0.75, display: "flex", gap: 6, alignItems: "center" }}>
                          <span>{fmtMelbourne(m.created_at)}</span>
                          {m.edited_at && <span style={{ opacity: 0.7 }}>(edited)</span>}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => {
                            setReplyToMessageId(m.id);
                            setEditingMessageId(null);
                            setEditText("");
                            composerRef.current?.focus();
                          }}
                          style={{
                            border: "1px solid rgba(255,255,255,0.14)",
                            background: "rgba(255,255,255,0.04)",
                            color: "var(--foreground)",
                            padding: "6px 10px",
                            borderRadius: 10,
                            cursor: "pointer",
                            fontWeight: 800,
                            fontSize: 12,
                            opacity: 0.9,
                          }}
                          type="button"
                          aria-label="Reply to message"
                        >
                          Reply
                        </button>

                        {canEdit && (
                          <button
                            onClick={() => startEdit(m)}
                            style={{
                              border: "1px solid rgba(255,255,255,0.14)",
                              background: "rgba(255,255,255,0.04)",
                              color: "var(--foreground)",
                              padding: "6px 10px",
                              borderRadius: 10,
                              cursor: "pointer",
                              fontWeight: 800,
                              fontSize: 12,
                              opacity: 0.9,
                            }}
                            type="button"
                            aria-label="Edit message"
                          >
                            Edit
                          </button>
                        )}

                        {canDelete && (
                          <button
                            onClick={() => deleteMessage(m)}
                            style={{
                              border: "1px solid rgba(255,255,255,0.14)",
                              background: "rgba(255,255,255,0.04)",
                              color: "var(--foreground)",
                              padding: "6px 10px",
                              borderRadius: 10,
                              cursor: "pointer",
                              fontWeight: 800,
                              fontSize: 12,
                              opacity: 0.9,
                            }}
                            type="button"
                            aria-label="Delete message"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {!canEdit && isOwner && !isAdmin && (
                      <div style={{ marginTop: 4, fontSize: 11, opacity: 0.6 }}>
                        Edit/delete window: 5 minutes after posting.
                      </div>
                    )}

                    {!!m.reply_to_message_id && (
                      <button
                        type="button"
                        onClick={() => {
                          if (m.reply_to_message_id) scrollToMessage(m.reply_to_message_id, true);
                        }}
                        style={{
                          marginTop: 8,
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(255,255,255,0.05)",
                          color: "inherit",
                          borderRadius: 10,
                          padding: "8px 10px",
                          cursor: m.reply_to_message_id ? "pointer" : "default",
                        }}
                      >
                        <div style={{ fontSize: 11, opacity: 0.75, fontWeight: 800 }}>Replying to {replyName}</div>
                        <div style={{ fontSize: 13, opacity: 0.9 }}>{snippet(replySource?.body || "Original message unavailable")}</div>
                      </button>
                    )}

                    {isEditing ? (
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          maxLength={CHAT_MAX_CHARS}
                          style={{
                            width: "100%",
                            minHeight: 90,
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px solid rgba(255,255,255,0.18)",
                            background: "rgba(255,255,255,0.04)",
                            color: "var(--foreground)",
                            fontFamily: "inherit",
                            fontSize: 14,
                            lineHeight: 1.4,
                            resize: "vertical",
                          }}
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                              e.preventDefault();
                              if (!savingEdit) saveEdit(m);
                            }
                          }}
                        />
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={savingEdit}
                            style={{
                              border: "1px solid rgba(255,255,255,0.14)",
                              background: "rgba(255,255,255,0.04)",
                              color: "var(--foreground)",
                              padding: "8px 12px",
                              borderRadius: 10,
                              cursor: savingEdit ? "not-allowed" : "pointer",
                              fontWeight: 800,
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => saveEdit(m)}
                            disabled={savingEdit}
                            style={{
                              border: "1px solid rgba(255,255,255,0.14)",
                              background: "rgba(255,255,255,0.10)",
                              color: "var(--foreground)",
                              padding: "8px 12px",
                              borderRadius: 10,
                              cursor: savingEdit ? "not-allowed" : "pointer",
                              fontWeight: 900,
                            }}
                          >
                            {savingEdit ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.35 }}>{renderBodyWithMentions(m.body)}</div>
                    )}

                    {/* Reactions (click to toggle, hover to see who reacted) */}
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {REACTIONS.map((e) => {
                        const count = r[e] ?? 0;

                        return (
                          <span
                            key={e}
                            onClick={() => toggleReaction(m.id, e)}
                            style={{
                              cursor: "pointer",
                              opacity: 1,
                              filter: mine[e] ? "brightness(1.08)" : "none",
                            }}
                            role="button"
                            aria-label={`React ${e}`}
                          >
                            <ReactionPill emoji={e} count={count} names={reactionNamesByMessage[m.id]?.[e] ?? []} />
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* New messages button (only when not at top) */}
          {newCount > 0 && !atTop && (
            <div
              style={{
                position: "sticky",
                top: 10,
                display: "flex",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <button
                onClick={() => scrollToTop(true)}
                style={{
                  pointerEvents: "auto",
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.12)",
                  color: "var(--foreground)",
                  padding: "10px 12px",
                  borderRadius: 999,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
                type="button"
              >
                New messages ({newCount}) ↑
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {replyTarget && (
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.05)",
              borderRadius: 12,
              padding: "8px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.75 }}>
                Replying to {nameByUserId[replyTarget.user_id] ?? "Anonymous tipster"}
              </div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>{snippet(replyTarget.body)}</div>
            </div>
            <button
              type="button"
              onClick={() => setReplyToMessageId(null)}
              style={{
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.04)",
                color: "var(--foreground)",
                padding: "6px 10px",
                borderRadius: 10,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              Cancel reply
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <textarea
            ref={composerRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={CHAT_MAX_CHARS}
            placeholder="Say something… Use @display-name or @username to mention someone"
            style={{
              flex: 1,
              minHeight: 44,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--foreground)",
              resize: "none",
              lineHeight: 1.35,
              fontFamily: "inherit",
              fontSize: 15,
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

        {composerMentionStatuses.length > 0 && (
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.03)",
              borderRadius: 12,
              padding: "8px 10px",
              display: "grid",
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: hasInvalidComposerMentions ? "rgb(180, 83, 9)" : "rgb(21, 128, 61)",
              }}
            >
              {hasInvalidComposerMentions
                ? "Mention check: some usernames were not found."
                : "Mention check: these people will be tagged."}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {composerMentionStatuses.map((mention) => (
                <span
                  key={mention.alias}
                  style={{
                    borderRadius: 999,
                    padding: "4px 8px",
                    fontSize: 12,
                    fontWeight: 800,
                    border: mention.valid ? "1px solid rgba(34, 197, 94, 0.55)" : "1px solid rgba(245, 158, 11, 0.60)",
                    background: mention.valid ? "rgba(34, 197, 94, 0.14)" : "rgba(245, 158, 11, 0.14)",
                    color: mention.valid ? "rgb(21, 128, 61)" : "rgb(180, 83, 9)",
                    lineHeight: 1.2,
                  }}
                >
                  {mention.valid
                    ? `@${mention.alias} -> ${mention.displayName ?? "Member"}`
                    : `@${mention.alias} not found`}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        Slow mode: 1 message / 3 seconds. Messages auto-delete after 30 days. You can edit/delete your own messages for 5
        minutes.
      </div>
    </main>
  );
}
