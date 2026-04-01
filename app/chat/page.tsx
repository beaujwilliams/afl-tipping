"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ReactionPill } from "@/components/ReactionPill";
import { UnpaidTag } from "@/components/UnpaidTag";

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

type MembershipCompetitionRoleRow = {
  competition_id: string | null;
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
  champion_highlight_user_ids?: string[];
};

type ComposerMentionStatus = {
  alias: string;
  valid: boolean;
  displayName: string | null;
};

type MentionCandidate = {
  userId: string;
  displayName: string;
  username: string | null;
  insertAlias: string;
  searchValue: string;
};

type ActiveMention = {
  start: number;
  end: number;
  query: string;
};

type RoundCompetitionRow = {
  competition_id: string;
};

type MentionDirectoryApiMember = {
  user_id: string;
  display_name: string | null;
  username: string | null;
};

type MentionDirectoryApiResponse = {
  ok?: boolean;
  members?: MentionDirectoryApiMember[];
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

function normalizeMentionAliasToken(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  const ascii = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalized = ascii
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!normalized) return "";
  return normalized.slice(0, 30);
}

function displayNameMentionAliases(displayName: string | null | undefined) {
  const parts = String(displayName ?? "")
    .trim()
    .split(/\s+/)
    .map((part) => normalizeMentionAliasToken(part))
    .filter(Boolean);
  if (!parts.length) return [];

  const aliases = new Set<string>();
  aliases.add(parts[0]);
  aliases.add(normalizeMentionAliasToken(parts.join("_")));
  aliases.add(normalizeMentionAliasToken(parts.join("")));

  return Array.from(aliases).filter((alias) => alias.length >= 2 && alias.length <= 30);
}

function displayNameReadableAlias(displayName: string | null | undefined) {
  const raw = String(displayName ?? "").trim();
  if (!raw) return "";
  const ascii = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const parts = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return "";
  return parts.join("_").slice(0, 30);
}

function pickPreferredMentionAlias(displayName: string, resolvableAliases: string[]) {
  if (!resolvableAliases.length) return null;
  const readable = displayNameReadableAlias(displayName);
  const readableNormalized = normalizeMentionAliasToken(readable);
  if (readableNormalized && resolvableAliases.includes(readableNormalized)) return readableNormalized;

  const compact = normalizeMentionAliasToken(readable.replace(/_/g, ""));
  if (compact && resolvableAliases.includes(compact)) return compact;

  const withUnderscore = resolvableAliases.find((alias) => alias.includes("_"));
  if (withUnderscore) return withUnderscore;
  return resolvableAliases[0];
}

function readableAliasFromPreferred(displayName: string, preferredAlias: string) {
  const readable = displayNameReadableAlias(displayName);
  if (readable && normalizeMentionAliasToken(readable) === preferredAlias) return readable;
  if (preferredAlias.includes("_")) {
    return preferredAlias
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("_");
  }
  return preferredAlias.charAt(0).toUpperCase() + preferredAlias.slice(1);
}

function bodyMentionsAnyAlias(text: string, aliases: Set<string>) {
  if (!aliases.size) return false;
  const found = extractMentionAliases(text);
  return found.some((alias) => aliases.has(alias));
}

function getActiveMention(text: string, cursor: number): ActiveMention | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const beforeCursor = text.slice(0, safeCursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) return null;

  const charBeforeAt = atIndex > 0 ? beforeCursor[atIndex - 1] : "";
  if (charBeforeAt && /[a-z0-9_]/i.test(charBeforeAt)) return null;

  const fragment = beforeCursor.slice(atIndex + 1);
  if (fragment.includes(" ") || fragment.includes("\n") || fragment.includes("\t")) return null;
  if (/[^a-z0-9_]/i.test(fragment)) return null;

  return {
    start: atIndex,
    end: safeCursor,
    query: fragment.toLowerCase(),
  };
}

function mentionCandidateScore(candidate: MentionCandidate, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const displayLower = candidate.displayName.toLowerCase();
  if (candidate.insertAlias.toLowerCase().startsWith(q)) return 1;
  if (displayLower.startsWith(q)) return 2;
  if (candidate.username?.toLowerCase().startsWith(q)) return 3;
  if (candidate.searchValue.includes(q)) return 4;
  return -1;
}

function pickMostFrequentCompetition(rows: RoundCompetitionRow[]) {
  if (!rows.length) return null;
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const id = String(row.competition_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  return Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  })[0]?.[0] ?? null;
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
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [paymentStatusByUserId, setPaymentStatusByUserId] = useState<Record<string, string | null>>({});
  const [championHighlightUserIds, setChampionHighlightUserIds] = useState<string[]>([]);
  const [reactions, setReactions] = useState<ReactionRow[]>([]);

  const [text, setText] = useState("");
  const [composerCursor, setComposerCursor] = useState(0);
  const [mentionSelectionIndex, setMentionSelectionIndex] = useState(0);
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
  const myUsernameAlias = normalizeMentionAliasToken(myUsername);
  const myDisplayName = userId ? nameByUserId[userId] ?? "" : "";
  const myMentionAliases = useMemo(() => {
    const aliases = new Set<string>();
    if (myUsernameAlias) aliases.add(myUsernameAlias);
    for (const alias of displayNameMentionAliases(myDisplayName)) aliases.add(alias);
    return aliases;
  }, [myUsernameAlias, myDisplayName]);
  const championHighlightSet = useMemo(
    () => new Set(championHighlightUserIds),
    [championHighlightUserIds]
  );

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

  const activeMention = useMemo(
    () => getActiveMention(text, composerCursor),
    [text, composerCursor]
  );

  const mentionSuggestions = useMemo(() => {
    if (!activeMention) return [];
    const scored = mentionCandidates
      .map((candidate) => ({
        candidate,
        score: mentionCandidateScore(candidate, activeMention.query),
      }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.candidate.displayName.localeCompare(b.candidate.displayName, "en", { sensitivity: "base" });
      })
      .slice(0, 8)
      .map((item) => item.candidate);
    return scored;
  }, [activeMention, mentionCandidates]);

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

  function applyMentionCandidate(candidate: MentionCandidate) {
    const active = getActiveMention(text, composerCursor);
    if (!active) return;

    const before = text.slice(0, active.start);
    const after = text.slice(active.end);
    const spacer = after.startsWith(" ") || after.startsWith("\n") || after.length === 0 ? "" : " ";
    const nextValue = `${before}@${candidate.insertAlias}${spacer}${after}`;
    const nextCursor = (before + `@${candidate.insertAlias}${spacer}`).length;

    setText(nextValue);
    setComposerCursor(nextCursor);
    setMentionSelectionIndex(0);

    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
    });
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

  async function loadMentionDirectory(accessToken: string, fallbackCompetitionId?: string | null) {
    let directoryRows: ProfileRow[] = [];

    try {
      const params = new URLSearchParams({ season: String(CURRENT_SEASON) });
      const res = await fetch(`/api/chat-mention-directory?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as MentionDirectoryApiResponse | null;
      if (res.ok && json?.ok && Array.isArray(json.members)) {
        directoryRows = json.members.map((m) => ({
          id: String(m.user_id),
          display_name: m.display_name ?? null,
          username: m.username ?? null,
        }));
      }
    } catch {
      // fall through to client-side fallback below
    }

    // Fallback if API route is temporarily unavailable.
    if (!directoryRows.length) {
      const compId = String(fallbackCompetitionId ?? "").trim();
      if (!compId) {
        setMentionableByAlias({});
        setMentionCandidates([]);
        return;
      }

      const { data: memberRows, error: memberErr } = await supabaseBrowser
        .from("memberships")
        .select("user_id")
        .eq("competition_id", compId);

      if (memberErr) {
        setMentionableByAlias({});
        setMentionCandidates([]);
        return;
      }

      const memberIds = Array.from(
        new Set(((memberRows ?? []) as MembershipUserRow[]).map((m) => String(m.user_id)))
      );
      if (!memberIds.length) {
        setMentionableByAlias({});
        setMentionCandidates([]);
        return;
      }

      const { data: profRows, error: profErr } = await supabaseBrowser
        .from("profiles")
        .select("id, display_name, username")
        .in("id", memberIds);

      if (profErr) {
        if (!isMissingColumnError(profErr.message, "username")) {
          setMentionableByAlias({});
          setMentionCandidates([]);
          return;
        }

        const fallback = await supabaseBrowser
          .from("profiles")
          .select("id, display_name")
          .in("id", memberIds);
        if (fallback.error) {
          setMentionableByAlias({});
          setMentionCandidates([]);
          return;
        }
        directoryRows = ((fallback.data ?? []) as ProfileRow[]).map((p) => ({
          ...p,
          username: null,
        }));
      } else {
        directoryRows = (profRows ?? []) as ProfileRow[];
      }
    }

    const usernamesMap: Record<string, string> = {};
    const byAlias: Record<string, string> = {};
    const namesMap: Record<string, string> = {};
    const ambiguousAliases = new Set<string>();
    const mentionRows: Array<{ userId: string; displayName: string; username: string | null; aliases: string[] }> = [];

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
      const usernameAlias = normalizeMentionAliasToken(username);
      const aliases = Array.from(
        new Set([
          ...displayNameMentionAliases(displayName),
          ...(usernameAlias ? [usernameAlias] : []),
        ])
      );

      if (displayName) namesMap[uid] = displayName;
      if (username) {
        usernamesMap[uid] = username;
      }
      if (usernameAlias) {
        addAlias(usernameAlias, uid);
      }
      for (const alias of displayNameMentionAliases(displayName)) addAlias(alias, uid);

      mentionRows.push({
        userId: uid,
        displayName: displayName || (username ? `@${username}` : "Member"),
        username: username || null,
        aliases,
      });
    });

    // Ensure every member has at least one resolvable alias in the picker.
    const usedAliases = new Set(Object.keys(byAlias));
    mentionRows.forEach((row) => {
      const alreadyResolvable = row.aliases.some((alias) => byAlias[alias] === row.userId);
      if (alreadyResolvable) return;

      const rawBase = row.aliases[0] || row.displayName || row.username || `member_${row.userId.slice(0, 6)}`;
      let base = normalizeMentionAliasToken(rawBase);
      if (!base || base.length < 2) {
        base = normalizeMentionAliasToken(`member_${row.userId.slice(0, 6)}`);
      }
      if (!base || base.length < 2) {
        base = `member_${Math.abs(row.userId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0))}`;
      }

      let candidate = base.slice(0, 30);
      let suffix = 2;
      while (usedAliases.has(candidate)) {
        const suffixText = `_${suffix}`;
        const head = base.slice(0, Math.max(2, 30 - suffixText.length)).replace(/_+$/g, "");
        candidate = `${head || "member"}${suffixText}`;
        suffix += 1;
      }

      usedAliases.add(candidate);
      byAlias[candidate] = row.userId;
      row.aliases.push(candidate);
    });

    const candidateList: MentionCandidate[] = mentionRows
      .map((row) => {
        const resolvableAliases = row.aliases.filter((alias) => byAlias[alias] === row.userId);
        const preferredAlias = pickPreferredMentionAlias(row.displayName, resolvableAliases);
        if (!preferredAlias) return null;
        return {
          userId: row.userId,
          displayName: row.displayName,
          username: row.username,
          insertAlias: readableAliasFromPreferred(row.displayName, preferredAlias),
          searchValue: `${row.displayName.toLowerCase()} ${row.aliases.join(" ")} ${row.username ?? ""} ${preferredAlias}`
            .trim()
            .toLowerCase(),
        };
      })
      .filter((row): row is MentionCandidate => !!row)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }));

    setNameByUserId((prev) => ({ ...prev, ...namesMap }));
    setUsernameByUserId((prev) => ({ ...prev, ...usernamesMap }));
    setMentionableByAlias(byAlias);
    setMentionCandidates(candidateList);
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

    let resolvedCompId: string | null = null;
    let resolvedRole: string | null = null;

    const { data: myMembershipRows } = await supabaseBrowser
      .from("memberships")
      .select("competition_id, role")
      .eq("user_id", currentUserId)
      .limit(50);

    const memberships = (myMembershipRows as MembershipCompetitionRoleRow[] | null) ?? [];
    const candidateCompetitionIds = Array.from(
      new Set(
        memberships
          .map((m) => String(m.competition_id ?? "").trim())
          .filter((id) => id.length > 0)
      )
    );

    if (candidateCompetitionIds.length) {
      const { data: seasonRounds, error: seasonRoundsErr } = await supabaseBrowser
        .from("rounds")
        .select("competition_id")
        .eq("season", CURRENT_SEASON)
        .in("competition_id", candidateCompetitionIds);

      if (!seasonRoundsErr && seasonRounds?.length) {
        resolvedCompId = pickMostFrequentCompetition((seasonRounds ?? []) as RoundCompetitionRow[]) ?? null;
      }

      if (!resolvedCompId) {
        resolvedCompId = candidateCompetitionIds.sort((a, b) => a.localeCompare(b))[0] ?? null;
      }

      const selectedMembership = memberships.find(
        (m) => String(m.competition_id ?? "").trim() === resolvedCompId
      );
      resolvedRole = selectedMembership?.role ?? null;
    } else {
      const { data: comp } = await supabaseBrowser
        .from("competitions")
        .select("id")
        .limit(1)
        .single();

      if (comp?.id) {
        resolvedCompId = String(comp.id);
        const { data: membership } = await supabaseBrowser
          .from("memberships")
          .select("role")
          .eq("competition_id", comp.id)
          .eq("user_id", currentUserId)
          .maybeSingle();
        resolvedRole = (membership as MembershipRoleRow | null)?.role ?? null;
      }
    }

    if (resolvedCompId) {
      setCompetitionId(resolvedCompId);
      setIsAdmin(isAdminRole(resolvedRole));
      await loadMentionDirectory(s.session.access_token, resolvedCompId);
    } else {
      setCompetitionId(null);
      setIsAdmin(false);
      setMentionableByAlias({});
      setMentionCandidates([]);
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
        const usernameAlias = normalizeMentionAliasToken(username);
        if (name) nameMap[uid] = name;
        if (team) teamMap[uid] = team;
        if (username) {
          usernameMap[uid] = username;
        }
        if (usernameAlias && !usernameMap[uid]) {
          usernameMap[uid] = usernameAlias;
        }
      });

      setNameByUserId((prev) => ({ ...prev, ...nameMap }));
      setFavoriteTeamByUserId((prev) => ({ ...prev, ...teamMap }));
      setUsernameByUserId((prev) => ({ ...prev, ...usernameMap }));

      // Fallback/merge mention directory from visible chat participants.
      const localAliasMap: Record<string, string> = {};
      const ambiguousLocalAliases = new Set<string>();
      const localMentionRows: Array<{ userId: string; displayName: string; username: string | null; aliases: string[] }> = [];

      function addLocalAlias(alias: string, uid: string) {
        const key = String(alias ?? "")
          .trim()
          .toLowerCase();
        if (key.length < 2 || key.length > 30) return;
        if (ambiguousLocalAliases.has(key)) return;
        const existing = localAliasMap[key];
        if (!existing) {
          localAliasMap[key] = uid;
          return;
        }
        if (existing !== uid) {
          delete localAliasMap[key];
          ambiguousLocalAliases.add(key);
        }
      }

      profRows.forEach((p) => {
        const uid = String(p.id);
        const displayName = String(p.display_name ?? "").trim();
        const username = String(p.username ?? "").trim().toLowerCase();
        const usernameAlias = normalizeMentionAliasToken(username);
        const aliases = Array.from(
          new Set([
            ...displayNameMentionAliases(displayName),
            ...(usernameAlias ? [usernameAlias] : []),
          ])
        );
        aliases.forEach((alias) => addLocalAlias(alias, uid));
        localMentionRows.push({
          userId: uid,
          displayName: displayName || (username ? `@${username}` : "Member"),
          username: username || null,
          aliases,
        });
      });

      const localCandidates: MentionCandidate[] = localMentionRows
        .map((row) => {
          const resolvableAliases = row.aliases.filter((alias) => localAliasMap[alias] === row.userId);
          const preferredAlias = pickPreferredMentionAlias(row.displayName, resolvableAliases);
          if (!preferredAlias) return null;
          return {
            userId: row.userId,
            displayName: row.displayName,
            username: row.username,
            insertAlias: readableAliasFromPreferred(row.displayName, preferredAlias),
            searchValue: `${row.displayName.toLowerCase()} ${row.aliases.join(" ")} ${row.username ?? ""} ${preferredAlias}`
              .trim()
              .toLowerCase(),
          };
        })
        .filter((row): row is MentionCandidate => !!row)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }));

      setMentionableByAlias((prev) => {
        const next = { ...prev };
        Object.entries(localAliasMap).forEach(([alias, uid]) => {
          if (!next[alias]) next[alias] = uid;
        });
        return next;
      });

      setMentionCandidates((prev) => {
        const byUserId = new Map(prev.map((candidate) => [candidate.userId, candidate]));
        localCandidates.forEach((candidate) => {
          if (!byUserId.has(candidate.userId)) byUserId.set(candidate.userId, candidate);
        });
        return Array.from(byUserId.values()).sort((a, b) =>
          a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" })
        );
      });

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
    setMentionSelectionIndex(0);
  }, [activeMention?.start, activeMention?.query, mentionSuggestions.length]);

  useEffect(() => {
    if (!competitionId) {
      setChampionHighlightUserIds([]);
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
          setChampionHighlightUserIds([]);
          return;
        }

        const championIds = Array.isArray(json.champion_highlight_user_ids)
          ? json.champion_highlight_user_ids
              .map((value) => (typeof value === "string" ? value.trim() : ""))
              .filter(Boolean)
          : [];
        const reigningChampionUserId =
          typeof json.reigning_champion_user_id === "string"
            ? json.reigning_champion_user_id.trim()
            : "";
        if (reigningChampionUserId && !championIds.includes(reigningChampionUserId)) {
          championIds.unshift(reigningChampionUserId);
        }
        setChampionHighlightUserIds(Array.from(new Set(championIds)));
      } catch {
        if (!alive) return;
        setChampionHighlightUserIds([]);
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
      const paymentStatus = paymentStatusByUserId[r.user_id] ?? null;
      const display = paymentStatus === "pending" ? `${name} (unpaid)` : name;
      if (seen[r.message_id][r.emoji].has(display)) continue;

      seen[r.message_id][r.emoji].add(display);
      out[r.message_id][r.emoji].push(display);
    }

    return out;
  }, [reactions, nameByUserId, paymentStatusByUserId]);

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
    setComposerCursor(0);
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
            Mention people with their leaderboard name (for example @Jordan_Daley).
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
                          <span
                            style={{
                              color:
                                championHighlightSet.has(m.user_id)
                                  ? "var(--champion-gold)"
                                  : undefined,
                            }}
                          >
                            {who}
                          </span>
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
            onChange={(e) => {
              setText(e.target.value);
              setComposerCursor(e.target.selectionStart ?? e.target.value.length);
            }}
            onClick={(e) => setComposerCursor(e.currentTarget.selectionStart ?? text.length)}
            onKeyUp={(e) => setComposerCursor(e.currentTarget.selectionStart ?? text.length)}
            maxLength={CHAT_MAX_CHARS}
            placeholder="Say something… Use @Leaderboard_Name to mention someone"
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
              if (activeMention && mentionSuggestions.length) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionSelectionIndex((idx) => Math.min(idx + 1, mentionSuggestions.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionSelectionIndex((idx) => Math.max(idx - 1, 0));
                  return;
                }
                if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                  e.preventDefault();
                  const selected = mentionSuggestions[Math.min(mentionSelectionIndex, mentionSuggestions.length - 1)];
                  if (selected) applyMentionCandidate(selected);
                  return;
                }
              }
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

        {activeMention && mentionSuggestions.length > 0 && (
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.03)",
              borderRadius: 12,
              padding: "6px",
              display: "grid",
              gap: 4,
            }}
          >
            {mentionSuggestions.map((candidate, idx) => (
              <button
                key={candidate.userId}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyMentionCandidate(candidate)}
                style={{
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: idx === mentionSelectionIndex ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.02)",
                  color: "var(--foreground)",
                  borderRadius: 10,
                  padding: "8px 10px",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <span style={{ fontWeight: 800 }}>{candidate.displayName}</span>
                <span style={{ fontSize: 12, opacity: 0.78 }}>@{candidate.insertAlias}</span>
              </button>
            ))}
          </div>
        )}

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
                ? "Mention check: some mentions were not found."
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
                    ? `Tagged: ${mention.displayName ?? "Member"}`
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
