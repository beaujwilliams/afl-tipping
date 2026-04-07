"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiTableHeadCell, UiTableScroll, UiTableShell } from "@/components/ui";
import { ChampionSeasonLabels } from "@/components/ChampionSeasonLabels";
import {
  editableChampionSeasons,
  normalizeChampionSeasonsByUserId,
  normalizeSeasonChampionSelections,
  sameSeasonChampionSelections,
  type SeasonChampionSelection,
} from "@/lib/champion-metadata";

type Member = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  payment_status: string | null;
  is_test_account: boolean;
  joined_at: string;
};

type MemberRole = "owner" | "admin" | "member";
type PaymentStatus = "paid" | "pending" | "waived";
type PaymentFilter = "all" | PaymentStatus;

type RowDraft = {
  display_name: string;
  role: MemberRole;
  payment_status: PaymentStatus;
  is_test_account: boolean;
};

type MembersResponse = {
  ok?: boolean;
  members?: Member[];
  error?: string;
  details?: string;
};

type PaymentSettingsResponse = {
  ok?: boolean;
  enforce_unpaid_tip_lock?: boolean;
  error?: string;
  details?: string;
};

type PaymentReminderSendResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  pending_members?: number;
  recipients_targeted?: number;
  totals?: {
    sent?: number;
    simulated?: number;
    failed?: number;
    no_email?: number;
    skipped_already_sent?: number;
  };
};

type ChampionSettingsResponse = {
  ok?: boolean;
  reigning_champion_user_id?: string | null;
  override_user_id?: string | null;
  champion_seasons_by_user_id?: Record<string, number[]>;
  season_champions?: SeasonChampionSelection[];
  source?: "override" | "season_champion" | "none";
  champion_season?: number | null;
  error?: string;
  details?: string;
};

const CURRENT_SEASON = 2026;
const BUY_IN_BY_SEASON: Record<number, number> = {
  2026: 30,
};

function normalizeRole(role: string | null | undefined): MemberRole {
  const r = String(role ?? "")
    .trim()
    .toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

function normalizePaymentStatus(status: string | null | undefined): PaymentStatus {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (s === "paid" || s === "pending" || s === "waived") return s;
  return "pending";
}

function fmtMelbourne(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtDollars(amount: number) {
  const rounded = Math.max(0, Math.round(Number(amount) || 0));
  return `$${rounded.toLocaleString("en-AU")}`;
}

function shortId(id: string) {
  return `${id.slice(0, 8)}…`;
}

function normalizeChampionSource(
  source: string | null | undefined
): "override" | "season_champion" | "none" {
  if (source === "override" || source === "season_champion" || source === "none") {
    return source;
  }
  return "none";
}

function roleChipStyle(role: MemberRole): React.CSSProperties {
  if (role === "owner") {
    return {
      background: "rgba(245, 158, 11, 0.15)",
      color: "rgb(180, 83, 9)",
      border: "1px solid rgba(245, 158, 11, 0.35)",
    };
  }
  if (role === "admin") {
    return {
      background: "rgba(59, 130, 246, 0.14)",
      color: "rgb(30, 64, 175)",
      border: "1px solid rgba(59, 130, 246, 0.30)",
    };
  }
  return {
    background: "rgba(107, 114, 128, 0.10)",
    color: "rgb(55, 65, 81)",
    border: "1px solid rgba(107, 114, 128, 0.25)",
  };
}

function paymentChipStyle(status: PaymentStatus): React.CSSProperties {
  if (status === "paid") {
    return {
      background: "rgba(16, 185, 129, 0.14)",
      color: "rgb(6, 95, 70)",
      border: "1px solid rgba(16, 185, 129, 0.30)",
    };
  }
  if (status === "waived") {
    return {
      background: "rgba(139, 92, 246, 0.14)",
      color: "rgb(91, 33, 182)",
      border: "1px solid rgba(139, 92, 246, 0.30)",
    };
  }
  return {
    background: "rgba(239, 68, 68, 0.14)",
    color: "rgb(153, 27, 27)",
    border: "1px solid rgba(239, 68, 68, 0.32)",
  };
}

export default function AdminMembersPage() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [draftById, setDraftById] = useState<Record<string, RowDraft>>({});

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");

  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const [enforceUnpaidTipLock, setEnforceUnpaidTipLock] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sendingPaymentReminders, setSendingPaymentReminders] = useState(false);

  const [championResolvedUserId, setChampionResolvedUserId] = useState<string | null>(null);
  const [championResolvedSeason, setChampionResolvedSeason] = useState<number | null>(null);
  const [championSeasonSelections, setChampionSeasonSelections] = useState<SeasonChampionSelection[]>([]);
  const [savedChampionSeasonSelections, setSavedChampionSeasonSelections] = useState<
    SeasonChampionSelection[]
  >([]);
  const [championSeasonsByUserId, setChampionSeasonsByUserId] = useState<Record<string, number[]>>(
    {}
  );
  const [championSource, setChampionSource] = useState<
    "override" | "season_champion" | "none"
  >("none");
  const [championMsg, setChampionMsg] = useState("");
  const [savingChampion, setSavingChampion] = useState(false);

  function buildDraft(rows: Member[]) {
    const out: Record<string, RowDraft> = {};
    rows.forEach((m) => {
      out[m.user_id] = {
        display_name: m.display_name ?? "",
        role: normalizeRole(m.role),
        payment_status: normalizePaymentStatus(m.payment_status),
        is_test_account: !!m.is_test_account,
      };
    });
    return out;
  }

  async function fetchMembers(token: string) {
    const res = await fetch("/api/admin/members", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as MembersResponse | null;
    if (!res.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      throw new Error((json?.error ?? "Failed to load members") + detail);
    }
    const rows = Array.isArray(json?.members) ? json?.members : [];
    return rows;
  }

  async function fetchSettings(token: string) {
    const res = await fetch("/api/admin/payment-settings", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = (await res.json().catch(() => null)) as PaymentSettingsResponse | null;
    if (!res.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      throw new Error((json?.error ?? "Failed to load payment settings") + detail);
    }

    return !!json?.enforce_unpaid_tip_lock;
  }

  function applyChampionResponse(json: ChampionSettingsResponse | null) {
    const resolvedUserId =
      typeof json?.reigning_champion_user_id === "string" ? json.reigning_champion_user_id : null;
    const source = normalizeChampionSource(json?.source);
    const resolvedSeason =
      typeof json?.champion_season === "number" && Number.isFinite(json.champion_season)
        ? json.champion_season
        : null;
    const seasonSelections = normalizeSeasonChampionSelections(json?.season_champions);
    const nextChampionSeasonsByUserId = normalizeChampionSeasonsByUserId(
      json?.champion_seasons_by_user_id
    );

    setChampionResolvedUserId(resolvedUserId);
    setChampionResolvedSeason(resolvedSeason);
    setChampionSeasonSelections(seasonSelections);
    setSavedChampionSeasonSelections(seasonSelections);
    setChampionSeasonsByUserId(nextChampionSeasonsByUserId);
    setChampionSource(source);
  }

  async function fetchChampionSettings(token: string) {
    const res = await fetch(`/api/admin/champion-settings?season=${CURRENT_SEASON}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as ChampionSettingsResponse | null;
    if (!res.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      throw new Error((json?.error ?? "Failed to load champion settings") + detail);
    }
    return json;
  }

  async function load() {
    setLoading(true);
    setMsg("");
    setChampionMsg("");

    const { data: sessionData } = await supabaseBrowser.auth.getSession();
    const token = sessionData.session?.access_token ?? null;
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSessionToken(token);

    try {
      const [rows, enforce] = await Promise.all([
        fetchMembers(token),
        fetchSettings(token),
      ]);

      setMembers(rows);
      setDraftById(buildDraft(rows));
      setEnforceUnpaidTipLock(enforce);

      try {
        const champion = await fetchChampionSettings(token);
        applyChampionResponse(champion);
      } catch (e: unknown) {
        setChampionMsg(e instanceof Error ? e.message : "Failed to load champion settings.");
      }
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    let paid = 0;
    let pending = 0;
    let waived = 0;
    let testAccounts = 0;

    members.forEach((m) => {
      if (m.is_test_account) {
        testAccounts += 1;
        return;
      }
      const status = normalizePaymentStatus(m.payment_status);
      if (status === "paid") paid += 1;
      else if (status === "waived") waived += 1;
      else pending += 1;
    });

    const total = paid + pending + waived;
    return {
      total,
      paid,
      pending,
      waived,
      testAccounts,
    };
  }, [members]);

  const seasonBuyIn = BUY_IN_BY_SEASON[CURRENT_SEASON] ?? 0;
  const amounts = useMemo(
    () => ({
      total: counts.total * seasonBuyIn,
      paid: counts.paid * seasonBuyIn,
      pending: counts.pending * seasonBuyIn,
      waived: counts.waived * seasonBuyIn,
    }),
    [counts, seasonBuyIn]
  );

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = members.filter((m) => {
      const payment = normalizePaymentStatus(m.payment_status);
      if (paymentFilter !== "all" && payment !== paymentFilter) return false;

      if (!needle) return true;
      const role = normalizeRole(m.role);
      const name = (m.display_name ?? "").toLowerCase();
      const email = (m.email ?? "").toLowerCase();
      const uid = m.user_id.toLowerCase();
      const testToken = m.is_test_account ? "test" : "live";
      return (
        name.includes(needle) ||
        email.includes(needle) ||
        uid.includes(needle) ||
        role.includes(needle) ||
        payment.includes(needle) ||
        testToken.includes(needle)
      );
    });
    filtered.sort((a, b) => {
      const aTest = a.is_test_account ? 1 : 0;
      const bTest = b.is_test_account ? 1 : 0;
      if (bTest !== aTest) return bTest - aTest;

      const aJoined = new Date(a.joined_at).getTime();
      const bJoined = new Date(b.joined_at).getTime();
      const aSafe = Number.isFinite(aJoined) ? aJoined : 0;
      const bSafe = Number.isFinite(bJoined) ? bJoined : 0;
      if (aSafe !== bSafe) return aSafe - bSafe;
      return a.user_id.localeCompare(b.user_id);
    });
    return filtered;
  }, [members, search, paymentFilter]);

  function setDraftField(userId: string, patch: Partial<RowDraft>) {
    setDraftById((prev) => ({
      ...prev,
      [userId]: {
        display_name: patch.display_name ?? prev[userId]?.display_name ?? "",
        role: patch.role ?? prev[userId]?.role ?? "member",
        payment_status: patch.payment_status ?? prev[userId]?.payment_status ?? "pending",
        is_test_account: patch.is_test_account ?? prev[userId]?.is_test_account ?? false,
      },
    }));
  }

  async function saveMember(userId: string, patch?: Partial<RowDraft>) {
    if (!sessionToken) return;

    const member = members.find((m) => m.user_id === userId);
    if (!member) return;

    const draft = draftById[userId] ?? {
      display_name: member.display_name ?? "",
      role: normalizeRole(member.role),
      payment_status: normalizePaymentStatus(member.payment_status),
      is_test_account: !!member.is_test_account,
    };

    const hasPatchField =
      patch?.display_name !== undefined ||
      patch?.role !== undefined ||
      patch?.payment_status !== undefined ||
      patch?.is_test_account !== undefined;
    if (patch && !hasPatchField) return;

    setSavingMemberId(userId);
    setMsg("");

    const body: {
      user_id: string;
      display_name?: string;
      role?: MemberRole;
      payment_status?: PaymentStatus;
      is_test_account?: boolean;
    } = { user_id: userId };

    if (patch) {
      if (patch.display_name !== undefined) body.display_name = patch.display_name;
      if (patch.role !== undefined) body.role = patch.role;
      if (patch.payment_status !== undefined) body.payment_status = patch.payment_status;
      if (patch.is_test_account !== undefined) body.is_test_account = patch.is_test_account;
    } else {
      body.display_name = draft.display_name;
      body.role = draft.role;
      body.payment_status = draft.payment_status;
      body.is_test_account = draft.is_test_account;
    }

    const res = await fetch("/api/admin/members", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => null)) as MembersResponse | null;
    setSavingMemberId(null);

    if (!res.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      setMsg((json?.error ?? "Failed to save member") + detail);
      return;
    }

    setMembers((prev) =>
      prev.map((m) =>
        m.user_id === userId
          ? {
              ...m,
              display_name:
                patch?.display_name !== undefined
                  ? patch.display_name.trim() || null
                  : patch
                    ? m.display_name
                    : draft.display_name.trim() || null,
              role:
                patch?.role !== undefined
                  ? patch.role
                  : patch
                    ? m.role
                    : draft.role,
              payment_status:
                patch?.payment_status !== undefined
                  ? patch.payment_status
                  : patch
                    ? m.payment_status
                    : draft.payment_status,
              is_test_account:
                patch?.is_test_account !== undefined
                  ? patch.is_test_account
                  : patch
                    ? m.is_test_account
                    : draft.is_test_account,
            }
          : m
      )
    );
  }

  async function removeMember(userId: string) {
    if (!sessionToken) return;
    const ok = confirm("Remove this person from the comp? They won’t be able to tip anymore.");
    if (!ok) return;

    setRemovingMemberId(userId);
    setMsg("");

    const res = await fetch("/api/admin/members", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ user_id: userId }),
    });

    const json = (await res.json().catch(() => null)) as MembersResponse | null;
    setRemovingMemberId(null);

    if (!res.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      setMsg((json?.error ?? "Failed to remove member") + detail);
      return;
    }

    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    setDraftById((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });

    try {
      const champion = await fetchChampionSettings(sessionToken);
      applyChampionResponse(champion);
    } catch (e: unknown) {
      setChampionMsg(e instanceof Error ? e.message : "Failed to refresh champion settings.");
    }
  }

  async function saveSettings(nextValue: boolean) {
    if (!sessionToken) return;
    setSavingSettings(true);
    setMsg("");

    const res = await fetch("/api/admin/payment-settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ enforce_unpaid_tip_lock: nextValue }),
    });

    const json = (await res.json().catch(() => null)) as PaymentSettingsResponse | null;
    setSavingSettings(false);

    if (!res.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      setMsg((json?.error ?? "Failed to save payment settings") + detail);
      return;
    }

    setEnforceUnpaidTipLock(nextValue);
  }

  async function sendPaymentReminders() {
    if (!sessionToken) return;
    const ok = confirm(
      "Send payment reminder emails now? This will contact members with payment status pending who have not already been sent this reminder this season."
    );
    if (!ok) return;

    setSendingPaymentReminders(true);
    setMsg("");

    const res = await fetch(`/api/admin/send-payment-reminders?season=${CURRENT_SEASON}`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
      cache: "no-store",
    });

    const json = (await res.json().catch(() => null)) as PaymentReminderSendResponse | null;
    setSendingPaymentReminders(false);

    if (!res.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      setMsg((json?.error ?? "Failed to send payment reminders") + detail);
      return;
    }

    const totals = json?.totals ?? {};
    setMsg(
      `Payment reminders: sent ${totals.sent ?? 0}. Already sent ${totals.skipped_already_sent ?? 0}. No email ${totals.no_email ?? 0}. Failed ${totals.failed ?? 0}.`
    );
  }

  async function saveChampionSettings() {
    if (!sessionToken) return;

    setSavingChampion(true);
    setChampionMsg("");

    const res = await fetch(`/api/admin/champion-settings?season=${CURRENT_SEASON}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        season_champions: championSeasonSelections,
      }),
    });

    const json = (await res.json().catch(() => null)) as ChampionSettingsResponse | null;
    setSavingChampion(false);

    if (!res.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      setChampionMsg((json?.error ?? "Failed to save champion settings") + detail);
      return;
    }

    applyChampionResponse(json);
  }

  function setSeasonChampionSelection(season: number, userId: string | null) {
    setChampionSeasonSelections((prev) => {
      const next = prev.filter((entry) => entry.season !== season);
      next.push({ season, user_id: userId });
      next.sort((a, b) => a.season - b.season);
      return next;
    });
  }

  const championDirty = !sameSeasonChampionSelections(
    championSeasonSelections,
    savedChampionSeasonSelections
  );

  const championNameByUserId = useMemo(() => {
    const out: Record<string, string> = {};
    members.forEach((m) => {
      const draftName = draftById[m.user_id]?.display_name?.trim() ?? "";
      const memberName = m.display_name?.trim() ?? "";
      const email = m.email?.trim() ?? "";
      out[m.user_id] = draftName || memberName || email || shortId(m.user_id);
    });
    return out;
  }, [members, draftById]);
  const championMemberOptions = useMemo(
    () =>
      [...members].sort((a, b) =>
        (championNameByUserId[a.user_id] ?? shortId(a.user_id)).localeCompare(
          championNameByUserId[b.user_id] ?? shortId(b.user_id),
          "en",
          { sensitivity: "base" }
        )
      ),
    [members, championNameByUserId]
  );

  const championResolvedLabel = championResolvedUserId
    ? championNameByUserId[championResolvedUserId] ?? shortId(championResolvedUserId)
    : "None";
  const championEditableSeasons = useMemo(
    () => editableChampionSeasons(CURRENT_SEASON, championSeasonSelections),
    [championSeasonSelections]
  );

  const cardStyle: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 12,
    background: "var(--card-soft)",
  };

  const toolCardStyle: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 18,
    background: "var(--card)",
  };

  return (
    <main style={{ maxWidth: 1180, margin: "30px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Manage Members</h1>
        <button
          onClick={load}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--foreground)",
            fontWeight: 700,
          }}
        >
          Refresh
        </button>
      </div>

      <div style={{ marginTop: 14, ...cardStyle }}>
        <div style={toolCardStyle}>
          <div style={{ fontWeight: 800 }}>Payment reminders (manual)</div>
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
            Send payment reminder emails to members with payment status <b>pending</b>.
          </div>
          <button
            type="button"
            disabled={sendingPaymentReminders}
            onClick={sendPaymentReminders}
            style={{
              marginTop: 12,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--foreground)",
              fontWeight: 900,
              cursor: sendingPaymentReminders ? "not-allowed" : "pointer",
              opacity: sendingPaymentReminders ? 0.7 : 1,
            }}
          >
            {sendingPaymentReminders ? "Sending…" : "Send Payment Pending Reminders"}
          </button>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800 }}>Unpaid tip lock</div>
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                  When ON, members with payment status <b>pending</b> cannot submit tips.
                  Log in/chat/results remain available.
                </div>
              </div>
              <button
                type="button"
                disabled={savingSettings}
                onClick={() => saveSettings(!enforceUnpaidTipLock)}
                style={{
                  alignSelf: "flex-start",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: enforceUnpaidTipLock ? "#fee2e2" : "#ecfdf5",
                  color: enforceUnpaidTipLock ? "#991b1b" : "#065f46",
                  fontWeight: 900,
                  cursor: savingSettings ? "not-allowed" : "pointer",
                  opacity: savingSettings ? 0.7 : 1,
                }}
              >
                {savingSettings ? "Saving…" : enforceUnpaidTipLock ? "ON (Click to disable)" : "OFF (Click to enable)"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <details
        style={{
          marginTop: 12,
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 12,
          background: "var(--card-soft)",
        }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Advanced / Seasonal settings</summary>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 260 }}>
            <div style={{ fontWeight: 800 }}>Previous seasons winners</div>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
              Choose the winner for each season. Saved winners are highlighted in gold across
              the site.
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                display: "flex",
                gap: 6,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span>
                Current reigning champion: <b>{championResolvedLabel}</b>
              </span>
              {championSource === "season_champion" && championResolvedSeason !== null && (
                <span style={{ opacity: 0.75 }}>(season {championResolvedSeason} winner)</span>
              )}
              {championSource === "override" && (
                <span style={{ opacity: 0.75 }}>(legacy manual override)</span>
              )}
              {championResolvedUserId && (
                <ChampionSeasonLabels seasons={championSeasonsByUserId[championResolvedUserId]} />
              )}
              {championSource === "none" && <span style={{ opacity: 0.75 }}>(not set)</span>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div
              style={{
                display: "grid",
                gap: 10,
                minWidth: 320,
                flex: "1 1 320px",
                maxWidth: 460,
              }}
            >
              {championEditableSeasons.map((seasonValue) => {
                const selectedUserId =
                  championSeasonSelections.find((entry) => entry.season === seasonValue)?.user_id ??
                  null;

                return (
                  <label
                    key={seasonValue}
                    style={{ display: "grid", gap: 4 }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 800, opacity: 0.78 }}>
                      {seasonValue} winner
                    </span>
                    <select
                      value={selectedUserId ?? ""}
                      onChange={(e) =>
                        setSeasonChampionSelection(seasonValue, e.target.value || null)
                      }
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        color: "var(--foreground)",
                        fontWeight: 700,
                      }}
                    >
                      <option value="">No winner selected</option>
                      {championMemberOptions.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {championNameByUserId[m.user_id] ?? shortId(m.user_id)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>

            <button
              type="button"
              disabled={savingChampion || !championDirty}
              onClick={saveChampionSettings}
              style={{
                alignSelf: "flex-start",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--foreground)",
                fontWeight: 900,
                cursor: savingChampion || !championDirty ? "not-allowed" : "pointer",
                opacity: savingChampion || !championDirty ? 0.7 : 1,
              }}
            >
              {savingChampion ? "Saving…" : "Save champion settings"}
            </button>
          </div>
        </div>

        {championMsg && (
          <div
            style={{
              marginTop: 10,
              border: "1px solid #f3c",
              borderRadius: 10,
              padding: "8px 10px",
              fontSize: 12,
            }}
          >
            {championMsg}
          </div>
        )}
      </details>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Total live ({fmtDollars(amounts.total)})</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24 }}>{counts.total}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Paid live ({fmtDollars(amounts.paid)})</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "#065f46" }}>{counts.paid}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Pending live ({fmtDollars(amounts.pending)})</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "#991b1b" }}>{counts.pending}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Waived live ({fmtDollars(amounts.waived)})</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "#5b21b6" }}>{counts.waived}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Test accounts</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "#92400e" }}>{counts.testAccounts}</div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name / email / role / payment / id…"
          style={{
            flex: 1,
            minWidth: 260,
            padding: 12,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--foreground)",
          }}
        />
        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--foreground)",
            fontWeight: 700,
          }}
        >
          <option value="all">All payments</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="waived">Waived</option>
        </select>
      </div>

      {msg && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f3c", borderRadius: 12 }}>
          {msg}
        </div>
      )}

      {loading ? (
        <p style={{ marginTop: 16 }}>Loading…</p>
      ) : (
        <UiTableShell style={{ marginTop: 14 }}>
          {filteredMembers.length === 0 ? (
            <div style={{ padding: 16, opacity: 0.75 }}>No matching members.</div>
          ) : (
            <UiTableScroll>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1160 }}>
                <thead>
                  <tr style={{ background: "var(--card-soft)", textAlign: "left", fontSize: 12 }}>
                    <UiTableHeadCell>Name</UiTableHeadCell>
                    <UiTableHeadCell>Email</UiTableHeadCell>
                    <UiTableHeadCell>Role</UiTableHeadCell>
                    <UiTableHeadCell>Payment</UiTableHeadCell>
                    <UiTableHeadCell>Test Acc</UiTableHeadCell>
                    <UiTableHeadCell>Actions</UiTableHeadCell>
                    <UiTableHeadCell>Joined</UiTableHeadCell>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((m) => {
                    const draft = draftById[m.user_id] ?? {
                      display_name: m.display_name ?? "",
                      role: normalizeRole(m.role),
                      payment_status: normalizePaymentStatus(m.payment_status),
                      is_test_account: !!m.is_test_account,
                    };

                    const saving = savingMemberId === m.user_id;
                    const removing = removingMemberId === m.user_id;
                    const displayNameDirty = draft.display_name.trim() !== (m.display_name ?? "").trim();

                    return (
                      <tr key={m.user_id}>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
                          <input
                            value={draft.display_name}
                            onChange={(e) => setDraftField(m.user_id, { display_name: e.target.value })}
                            placeholder="Display name"
                            style={{
                              width: "100%",
                              padding: 9,
                              borderRadius: 9,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              color: "var(--foreground)",
                            }}
                          />
                          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 800,
                                borderRadius: 999,
                                padding: "2px 8px",
                                ...roleChipStyle(draft.role),
                              }}
                            >
                              {draft.role}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 800,
                                borderRadius: 999,
                                padding: "2px 8px",
                                ...paymentChipStyle(draft.payment_status),
                              }}
                            >
                              {draft.payment_status}
                            </span>
                            <ChampionSeasonLabels seasons={championSeasonsByUserId[m.user_id]} />
                            {draft.is_test_account && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 800,
                                  borderRadius: 999,
                                  padding: "2px 8px",
                                  background: "rgba(251, 191, 36, 0.16)",
                                  color: "rgb(146, 64, 14)",
                                  border: "1px solid rgba(245, 158, 11, 0.35)",
                                }}
                              >
                                test
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)", fontSize: 13 }}>
                          {m.email ?? `${m.user_id.slice(0, 8)}…`}
                        </td>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
                          <select
                            disabled={saving || removing}
                            value={draft.role}
                            onChange={(e) => {
                              const role = e.target.value as MemberRole;
                              setDraftField(m.user_id, { role });
                              void saveMember(m.user_id, { role });
                            }}
                            style={{
                              width: "100%",
                              padding: 9,
                              borderRadius: 9,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              color: "var(--foreground)",
                              fontWeight: 700,
                            }}
                          >
                            <option value="owner">owner</option>
                            <option value="admin">admin</option>
                            <option value="member">member</option>
                          </select>
                        </td>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
                          <select
                            disabled={saving || removing}
                            value={draft.payment_status}
                            onChange={(e) => {
                              const payment_status = e.target.value as PaymentStatus;
                              setDraftField(m.user_id, { payment_status });
                              void saveMember(m.user_id, { payment_status });
                            }}
                            style={{
                              width: "100%",
                              padding: 9,
                              borderRadius: 9,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              color: "var(--foreground)",
                              fontWeight: 700,
                            }}
                          >
                            <option value="paid">paid</option>
                            <option value="pending">pending</option>
                            <option value="waived">waived</option>
                          </select>
                        </td>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              opacity: saving || removing ? 0.7 : 1,
                            }}
                          >
                            <input
                              type="checkbox"
                              aria-label="Test account"
                              title="Test account"
                              disabled={saving || removing}
                              checked={draft.is_test_account}
                              onChange={(e) => {
                                const is_test_account = e.target.checked;
                                setDraftField(m.user_id, { is_test_account });
                                void saveMember(m.user_id, { is_test_account });
                              }}
                              style={{
                                cursor: saving || removing ? "not-allowed" : "pointer",
                                width: 16,
                                height: 16,
                              }}
                            />
                          </div>
                        </td>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              disabled={!displayNameDirty || saving || removing}
                              onClick={() => saveMember(m.user_id, { display_name: draft.display_name })}
                              style={{
                                padding: "9px 10px",
                                borderRadius: 10,
                                border: "1px solid var(--border)",
                                background: "var(--card)",
                                color: "var(--foreground)",
                                fontWeight: 800,
                                cursor: !displayNameDirty || saving || removing ? "not-allowed" : "pointer",
                                opacity: !displayNameDirty || saving || removing ? 0.7 : 1,
                              }}
                            >
                              {saving ? "Saving…" : "Save name"}
                            </button>
                            <button
                              disabled={saving || removing}
                              onClick={() => removeMember(m.user_id)}
                              style={{
                                padding: "9px 10px",
                                borderRadius: 10,
                                border: "1px solid rgba(236, 72, 153, 0.45)",
                                background: "var(--card)",
                                color: "var(--foreground)",
                                fontWeight: 900,
                                cursor: saving || removing ? "not-allowed" : "pointer",
                                opacity: saving || removing ? 0.7 : 1,
                              }}
                            >
                              {removing ? "Removing…" : "Remove"}
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)", fontSize: 13 }}>
                          {fmtMelbourne(m.joined_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </UiTableScroll>
          )}
        </UiTableShell>
      )}
    </main>
  );
}
