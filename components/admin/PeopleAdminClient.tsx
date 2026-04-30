"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  UiButton,
  UiButtonLink,
  UiCard,
  UiSectionHeader,
  UiTableHeadCell,
  UiTableScroll,
  UiTableShell,
} from "@/components/ui";
import { ChampionSeasonLabels } from "@/components/ChampionSeasonLabels";
import { AFL_TEAMS } from "@/lib/afl-teams";
import {
  editableChampionSeasons,
  normalizeChampionSeasonsByUserId,
  normalizeSeasonChampionSelections,
  sameSeasonChampionSelections,
  type SeasonChampionSelection,
} from "@/lib/champion-metadata";
import { CURRENT_SEASON as DEFAULT_CURRENT_SEASON } from "@/lib/season-config";

type Member = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  favorite_team: string | null;
  role: string | null;
  payment_status: string | null;
  is_test_account: boolean;
  joined_at: string;
};

type MemberRole = "owner" | "admin" | "member";
type PaymentStatus = "paid" | "pending" | "waived";
type PaymentFilter = "all" | PaymentStatus;
type RosterSortKey = "name" | "team" | "role" | "payment" | "email" | "joined";
type RosterSortDirection = "asc" | "desc";

type RowDraft = {
  display_name: string;
  favorite_team: string | null;
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

type ChampionSettingsResponse = {
  ok?: boolean;
  reigning_champion_user_id?: string | null;
  champion_seasons_by_user_id?: Record<string, number[]>;
  season_champions?: SeasonChampionSelection[];
  source?: "season_champion" | "none";
  champion_season?: number | null;
  error?: string;
  details?: string;
};

const BUY_IN_BY_SEASON: Record<number, number> = {
  2026: 30,
};

export type AdminPeoplePageMode = "settings" | "roster" | "combined";

type PeopleAdminClientProps = {
  mode?: AdminPeoplePageMode;
  season?: number;
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
): "season_champion" | "none" {
  if (source === "season_champion" || source === "none") {
    return source;
  }
  return "none";
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function compareNullableText(a: string, b: string) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return compareText(a, b);
}

export default function PeopleAdminClient({
  mode = "combined",
  season,
}: PeopleAdminClientProps) {
  const activeSeason =
    typeof season === "number" && Number.isFinite(season) && season >= 2000 && season <= 2100
      ? Math.trunc(season)
      : DEFAULT_CURRENT_SEASON;
  const showSettings = mode !== "roster";
  const showRoster = mode !== "settings";
  const toast = useToast();
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [draftById, setDraftById] = useState<Record<string, RowDraft>>({});

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [rosterSortBy, setRosterSortBy] = useState<RosterSortKey>("name");
  const [rosterSortDirection, setRosterSortDirection] = useState<RosterSortDirection>("asc");

  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const [enforceUnpaidTipLock, setEnforceUnpaidTipLock] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const [championResolvedUserId, setChampionResolvedUserId] = useState<string | null>(null);
  const [championResolvedSeason, setChampionResolvedSeason] = useState<number | null>(null);
  const [championSeasonSelections, setChampionSeasonSelections] = useState<SeasonChampionSelection[]>([]);
  const [savedChampionSeasonSelections, setSavedChampionSeasonSelections] = useState<
    SeasonChampionSelection[]
  >([]);
  const [championSeasonsByUserId, setChampionSeasonsByUserId] = useState<Record<string, number[]>>(
    {}
  );
  const [championSource, setChampionSource] = useState<"season_champion" | "none">("none");
  const [championMsg, setChampionMsg] = useState("");
  const [savingChampion, setSavingChampion] = useState(false);

  function buildDraft(rows: Member[]) {
    const out: Record<string, RowDraft> = {};
    rows.forEach((m) => {
      out[m.user_id] = {
        display_name: m.display_name ?? "",
        favorite_team: m.favorite_team ?? null,
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
    const res = await fetch(`/api/admin/champion-settings?season=${activeSeason}`, {
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
        showSettings ? fetchSettings(token) : Promise.resolve(false),
      ]);

      setMembers(rows);
      setDraftById(buildDraft(rows));
      if (showSettings) {
        setEnforceUnpaidTipLock(enforce);
      }

      if (showSettings) {
        try {
          const champion = await fetchChampionSettings(token);
          applyChampionResponse(champion);
        } catch (e: unknown) {
          setChampionMsg(e instanceof Error ? e.message : "Failed to load champion settings.");
        }
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

  const seasonBuyIn = BUY_IN_BY_SEASON[activeSeason] ?? 0;
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
      const team = (
        draftById[m.user_id]
          ? draftById[m.user_id].favorite_team ?? ""
          : m.favorite_team ?? ""
      ).toLowerCase();
      const uid = m.user_id.toLowerCase();
      const testToken = m.is_test_account ? "test" : "live";
      return (
        name.includes(needle) ||
        email.includes(needle) ||
        team.includes(needle) ||
        uid.includes(needle) ||
        role.includes(needle) ||
        payment.includes(needle) ||
        testToken.includes(needle)
      );
    });
    filtered.sort((a, b) => {
      const aDraft = draftById[a.user_id];
      const bDraft = draftById[b.user_id];
      const aTest = (aDraft?.is_test_account ?? a.is_test_account) ? 1 : 0;
      const bTest = (bDraft?.is_test_account ?? b.is_test_account) ? 1 : 0;
      if (bTest !== aTest) return bTest - aTest;

      const dir = rosterSortDirection === "asc" ? 1 : -1;
      const aName = (aDraft?.display_name ?? a.display_name ?? "").trim();
      const bName = (bDraft?.display_name ?? b.display_name ?? "").trim();
      const aRole = aDraft?.role ?? normalizeRole(a.role);
      const bRole = bDraft?.role ?? normalizeRole(b.role);
      const aPayment = aDraft?.payment_status ?? normalizePaymentStatus(a.payment_status);
      const bPayment = bDraft?.payment_status ?? normalizePaymentStatus(b.payment_status);
      const aTeam = (aDraft ? aDraft.favorite_team ?? "" : a.favorite_team ?? "").trim();
      const bTeam = (bDraft ? bDraft.favorite_team ?? "" : b.favorite_team ?? "").trim();
      const aEmail = (a.email ?? "").trim();
      const bEmail = (b.email ?? "").trim();
      const aJoined = Number(new Date(a.joined_at).getTime()) || 0;
      const bJoined = Number(new Date(b.joined_at).getTime()) || 0;

      let cmp = 0;
      if (rosterSortBy === "name") cmp = compareNullableText(aName, bName);
      else if (rosterSortBy === "team") cmp = compareNullableText(aTeam, bTeam);
      else if (rosterSortBy === "role") cmp = compareText(aRole, bRole);
      else if (rosterSortBy === "payment") cmp = compareText(aPayment, bPayment);
      else if (rosterSortBy === "email") cmp = compareNullableText(aEmail, bEmail);
      else if (rosterSortBy === "joined") cmp = aJoined - bJoined;

      if (cmp !== 0) return cmp * dir;

      const tieName = compareNullableText(aName, bName);
      if (tieName !== 0) return tieName;
      return a.user_id.localeCompare(b.user_id);
    });
    return filtered;
  }, [members, draftById, search, paymentFilter, rosterSortBy, rosterSortDirection]);

  function setDraftField(userId: string, patch: Partial<RowDraft>) {
    setDraftById((prev) => ({
      ...prev,
      [userId]: {
        display_name: patch.display_name ?? prev[userId]?.display_name ?? "",
        favorite_team:
          patch.favorite_team !== undefined
            ? patch.favorite_team
            : prev[userId]?.favorite_team ?? null,
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
      favorite_team: member.favorite_team ?? null,
      role: normalizeRole(member.role),
      payment_status: normalizePaymentStatus(member.payment_status),
      is_test_account: !!member.is_test_account,
    };

    const hasPatchField =
      patch?.display_name !== undefined ||
      patch?.favorite_team !== undefined ||
      patch?.role !== undefined ||
      patch?.payment_status !== undefined ||
      patch?.is_test_account !== undefined;
    if (patch && !hasPatchField) return;

    setSavingMemberId(userId);
    setMsg("");

    const body: {
      user_id: string;
      display_name?: string;
      favorite_team?: string | null;
      role?: MemberRole;
      payment_status?: PaymentStatus;
      is_test_account?: boolean;
    } = { user_id: userId };

    if (patch) {
      if (patch.display_name !== undefined) body.display_name = patch.display_name;
      if (patch.favorite_team !== undefined) body.favorite_team = patch.favorite_team;
      if (patch.role !== undefined) body.role = patch.role;
      if (patch.payment_status !== undefined) body.payment_status = patch.payment_status;
      if (patch.is_test_account !== undefined) body.is_test_account = patch.is_test_account;
    } else {
      body.display_name = draft.display_name;
      body.favorite_team = draft.favorite_team;
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
      toast.error((json?.error ?? "Failed to save member") + detail);
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
              favorite_team:
                patch?.favorite_team !== undefined
                  ? patch.favorite_team
                  : patch
                    ? m.favorite_team
                    : draft.favorite_team,
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
    toast.success("Member updated.");
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
      toast.error((json?.error ?? "Failed to remove member") + detail);
      return;
    }

    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    setDraftById((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });

    if (showSettings) {
      try {
        const champion = await fetchChampionSettings(sessionToken);
        applyChampionResponse(champion);
      } catch (e: unknown) {
        setChampionMsg(e instanceof Error ? e.message : "Failed to refresh champion settings.");
      }
    }

    toast.success("Member removed.");
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
      toast.error((json?.error ?? "Failed to save payment settings") + detail);
      return;
    }

    setEnforceUnpaidTipLock(nextValue);
    toast.success(`Unpaid tip lock ${nextValue ? "enabled" : "disabled"}.`);
  }

  async function saveChampionSettings() {
    if (!sessionToken) return;

    setSavingChampion(true);
    setChampionMsg("");

    const res = await fetch(`/api/admin/champion-settings?season=${activeSeason}`, {
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
      toast.error((json?.error ?? "Failed to save champion settings") + detail);
      return;
    }

    applyChampionResponse(json);
    toast.success("Champion settings saved.");
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
    () => editableChampionSeasons(activeSeason, championSeasonSelections),
    [activeSeason, championSeasonSelections]
  );
  const settingsHref = "/admin/settings/people";
  const rosterHref = `/admin/roster/${activeSeason}`;
  const pageSubtitle =
    mode === "settings"
      ? "Overall people settings that apply across seasons."
      : mode === "roster"
        ? `Roster management for season ${activeSeason}.`
        : "Overall people settings and current season roster management.";

  function onRosterSort(nextKey: RosterSortKey) {
    if (rosterSortBy === nextKey) {
      setRosterSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setRosterSortBy(nextKey);
    setRosterSortDirection(nextKey === "joined" ? "desc" : "asc");
  }

  function rosterSortMarker(key: RosterSortKey) {
    if (rosterSortBy !== key) return "";
    return rosterSortDirection === "asc" ? "Asc" : "Desc";
  }

  function sortableRosterHeader(label: string, key: RosterSortKey) {
    return (
      <UiTableHeadCell>
        <button
          type="button"
          onClick={() => onRosterSort(key)}
          style={{
            appearance: "none",
            background: "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            font: "inherit",
            fontWeight: rosterSortBy === key ? 800 : 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: 0,
            whiteSpace: "nowrap",
          }}
          title={`Sort by ${label}`}
        >
          <span>{label}</span>
          <span style={{ opacity: rosterSortBy === key ? 1 : 0.45, fontSize: 11, letterSpacing: -0.3 }}>
            {rosterSortMarker(key)}
          </span>
        </button>
      </UiTableHeadCell>
    );
  }

  const cardStyle: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 12,
    background: "var(--card-soft)",
  };

  function draftForMember(member: Member): RowDraft {
    return draftById[member.user_id] ?? {
      display_name: member.display_name ?? "",
      favorite_team: member.favorite_team ?? null,
      role: normalizeRole(member.role),
      payment_status: normalizePaymentStatus(member.payment_status),
      is_test_account: !!member.is_test_account,
    };
  }

  return (
    <main className="ui-page ui-page--wide ui-admin-page">
      <div className="ui-page-header">
        <div>
          <h1 className="ui-title">People</h1>
          <div className="ui-caption ui-mt-1">{pageSubtitle}</div>
        </div>
        <div className="ui-row-wrap">
          <UiButtonLink href="/admin">Back to admin</UiButtonLink>
          {mode !== "settings" && <UiButtonLink href={settingsHref}>People settings</UiButtonLink>}
          {mode !== "roster" && <UiButtonLink href={rosterHref}>Season roster</UiButtonLink>}
          <UiButtonLink href="/admin/payments">Payments</UiButtonLink>
          <UiButtonLink href="/admin/onboarding">Onboarding</UiButtonLink>
          <UiButton onClick={() => void load()}>Refresh</UiButton>
        </div>
      </div>

      {showSettings && (
        <>
          <UiCard soft className="ui-admin-section" style={{ marginTop: 12 }}>
            <UiSectionHeader
              title="People settings (overall)"
              subtitle="Applies across seasons."
            />
          </UiCard>

          <UiCard soft className="ui-admin-section" style={{ marginTop: 12 }}>
            <UiCard className="ui-admin-tool">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>Unpaid tip lock</div>
                  <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                    When ON, members with payment status <b>pending</b> cannot submit tips.
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
                    background: enforceUnpaidTipLock ? "var(--tone-danger-bg)" : "var(--tone-success-bg)",
                    color: enforceUnpaidTipLock ? "var(--tone-danger-text)" : "var(--tone-success-text)",
                    fontWeight: 900,
                    cursor: savingSettings ? "not-allowed" : "pointer",
                    opacity: savingSettings ? 0.7 : 1,
                  }}
                >
                  {savingSettings
                    ? "Saving…"
                    : enforceUnpaidTipLock
                      ? "ON (Click to disable)"
                      : "OFF (Click to enable)"}
                </button>
              </div>
            </UiCard>
          </UiCard>

          <details className="ui-card ui-card-soft ui-admin-details" style={{ marginTop: 12 }}>
            <summary className="ui-admin-details-summary">Season winners (all seasons)</summary>

            <div
              style={{ marginTop: 12, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
            >
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
        </>
      )}

      {msg && !showRoster && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f3c", borderRadius: 12 }}>
          {msg}
        </div>
      )}

      {showRoster && (
        <>
          <UiCard soft className="ui-admin-section" style={{ marginTop: 12 }}>
            <UiSectionHeader
              title={`Season ${activeSeason} roster`}
              subtitle="Manage members, roles, payments, and test accounts for this season."
              right={
                <div className="ui-row-wrap">
                  <span className="ui-caption">Season buy-in</span>
                  <strong>{fmtDollars(BUY_IN_BY_SEASON[activeSeason] ?? 0)}</strong>
                </div>
              }
            />
          </UiCard>

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
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "var(--tone-success-text)" }}>{counts.paid}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Pending live ({fmtDollars(amounts.pending)})</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "var(--tone-danger-text)" }}>{counts.pending}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Waived live ({fmtDollars(amounts.waived)})</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "var(--tone-purple-text)" }}>{counts.waived}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Test accounts</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "var(--tone-warning-text)" }}>{counts.testAccounts}</div>
        </div>
      </div>

      <UiCard soft style={{ marginTop: 12 }}>
        <div className="ui-row-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / team / email / role / payment / id…"
            className="ui-input"
            style={{ minWidth: 260, flex: 1 }}
          />
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
            className="ui-input"
            style={{ maxWidth: 180 }}
          >
            <option value="all">All payments</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="waived">Waived</option>
          </select>
        </div>
      </UiCard>

      {msg && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f3c", borderRadius: 12 }}>
          {msg}
        </div>
      )}

      {loading ? (
        <p style={{ marginTop: 16 }}>Loading…</p>
      ) : (
        <>
          <UiTableShell className="people-roster-table-shell" style={{ marginTop: 14 }}>
            {filteredMembers.length === 0 ? (
              <div style={{ padding: 16, opacity: 0.75 }}>No matching members.</div>
            ) : (
              <UiTableScroll>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1220 }}>
                  <thead>
                    <tr style={{ background: "var(--card-soft)", textAlign: "left", fontSize: 12 }}>
                      {sortableRosterHeader("Name", "name")}
                      {sortableRosterHeader("Team", "team")}
                      {sortableRosterHeader("Role", "role")}
                      {sortableRosterHeader("Payment", "payment")}
                      {sortableRosterHeader("Email", "email")}
                      <UiTableHeadCell>Actions</UiTableHeadCell>
                      {sortableRosterHeader("Joined", "joined")}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map((m) => {
                      const draft = draftForMember(m);

                      const saving = savingMemberId === m.user_id;
                      const removing = removingMemberId === m.user_id;
                      const displayNameDirty = draft.display_name.trim() !== (m.display_name ?? "").trim();

                      return (
                        <tr key={m.user_id}>
                          <td style={{ padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
                            <input
                              value={draft.display_name}
                              onChange={(e) => setDraftField(m.user_id, { display_name: e.target.value })}
                              placeholder="Display name"
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--card)",
                                color: "var(--foreground)",
                                fontSize: 13,
                              }}
                            />
                          </td>
                          <td style={{ padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
                            <select
                              disabled={saving || removing}
                              value={draft.favorite_team ?? ""}
                              onChange={(e) => {
                                const favorite_team = e.target.value.trim() || null;
                                setDraftField(m.user_id, { favorite_team });
                                void saveMember(m.user_id, { favorite_team });
                              }}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--card)",
                                color: "var(--foreground)",
                                fontWeight: 600,
                                fontSize: 13,
                              }}
                            >
                              <option value="">—</option>
                              {AFL_TEAMS.map((team) => (
                                <option key={team} value={team}>
                                  {team}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: "8px 10px", borderTop: "1px solid var(--border)", fontSize: 13 }}>
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
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--card)",
                                color: "var(--foreground)",
                                fontWeight: 700,
                                fontSize: 13,
                              }}
                            >
                              <option value="owner">owner</option>
                              <option value="admin">admin</option>
                              <option value="member">member</option>
                            </select>
                          </td>
                          <td style={{ padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
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
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "var(--card)",
                                color: "var(--foreground)",
                                fontWeight: 700,
                                fontSize: 13,
                              }}
                            >
                              <option value="paid">paid</option>
                              <option value="pending">pending</option>
                              <option value="waived">waived</option>
                            </select>
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              borderTop: "1px solid var(--border)",
                              fontSize: 13,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {m.email ?? `${m.user_id.slice(0, 8)}…`}
                          </td>
                          <td style={{ padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  opacity: saving || removing ? 0.7 : 1,
                                  whiteSpace: "nowrap",
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
                                <span>Test</span>
                              </label>
                              {displayNameDirty && (
                                <button
                                  disabled={!displayNameDirty || saving || removing}
                                  onClick={() => saveMember(m.user_id, { display_name: draft.display_name })}
                                  style={{
                                    padding: "6px 9px",
                                    borderRadius: 8,
                                    border: "1px solid var(--border)",
                                    background: "var(--card)",
                                    color: "var(--foreground)",
                                    fontSize: 13,
                                    fontWeight: 800,
                                    whiteSpace: "nowrap",
                                    cursor: !displayNameDirty || saving || removing ? "not-allowed" : "pointer",
                                    opacity: !displayNameDirty || saving || removing ? 0.7 : 1,
                                  }}
                                >
                                  {saving ? "Saving…" : "Save"}
                                </button>
                              )}
                              <button
                                disabled={saving || removing}
                                onClick={() => removeMember(m.user_id)}
                                style={{
                                  padding: "6px 9px",
                                  borderRadius: 8,
                                  border: "1px solid rgba(236, 72, 153, 0.45)",
                                  background: "var(--card)",
                                  color: "var(--foreground)",
                                  fontSize: 13,
                                  fontWeight: 900,
                                  whiteSpace: "nowrap",
                                  cursor: saving || removing ? "not-allowed" : "pointer",
                                  opacity: saving || removing ? 0.7 : 1,
                                }}
                              >
                                {removing ? "Removing…" : "Remove"}
                              </button>
                            </div>
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              borderTop: "1px solid var(--border)",
                              fontSize: 13,
                              whiteSpace: "nowrap",
                            }}
                          >
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

          <div className="people-roster-mobile-list">
            {filteredMembers.length === 0 ? (
              <div className="ui-card people-roster-mobile-empty">No matching members.</div>
            ) : (
              filteredMembers.map((m) => {
                const draft = draftForMember(m);
                const saving = savingMemberId === m.user_id;
                const removing = removingMemberId === m.user_id;
                const displayNameDirty = draft.display_name.trim() !== (m.display_name ?? "").trim();

                return (
                  <div key={`mobile-${m.user_id}`} className="people-roster-card">
                    <div className="people-roster-card__header">
                      <div className="people-roster-card__identity">
                        <label className="people-roster-field people-roster-field--name">
                          <span>Display name</span>
                          <input
                            value={draft.display_name}
                            onChange={(e) => setDraftField(m.user_id, { display_name: e.target.value })}
                            placeholder="Display name"
                            className="ui-input people-roster-control"
                          />
                        </label>
                        <div className="people-roster-email">
                          {m.email ?? `${m.user_id.slice(0, 8)}…`}
                        </div>
                      </div>
                      <span className={`people-roster-payment people-roster-payment--${draft.payment_status}`}>
                        {draft.payment_status}
                      </span>
                    </div>

                    <div className="people-roster-card__grid">
                      <label className="people-roster-field">
                        <span>Team</span>
                        <select
                          disabled={saving || removing}
                          value={draft.favorite_team ?? ""}
                          onChange={(e) => {
                            const favorite_team = e.target.value.trim() || null;
                            setDraftField(m.user_id, { favorite_team });
                            void saveMember(m.user_id, { favorite_team });
                          }}
                          className="ui-input people-roster-control"
                        >
                          <option value="">—</option>
                          {AFL_TEAMS.map((team) => (
                            <option key={team} value={team}>
                              {team}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="people-roster-field">
                        <span>Role</span>
                        <select
                          disabled={saving || removing}
                          value={draft.role}
                          onChange={(e) => {
                            const role = e.target.value as MemberRole;
                            setDraftField(m.user_id, { role });
                            void saveMember(m.user_id, { role });
                          }}
                          className="ui-input people-roster-control"
                        >
                          <option value="owner">owner</option>
                          <option value="admin">admin</option>
                          <option value="member">member</option>
                        </select>
                      </label>

                      <label className="people-roster-field">
                        <span>Payment</span>
                        <select
                          disabled={saving || removing}
                          value={draft.payment_status}
                          onChange={(e) => {
                            const payment_status = e.target.value as PaymentStatus;
                            setDraftField(m.user_id, { payment_status });
                            void saveMember(m.user_id, { payment_status });
                          }}
                          className="ui-input people-roster-control"
                        >
                          <option value="paid">paid</option>
                          <option value="pending">pending</option>
                          <option value="waived">waived</option>
                        </select>
                      </label>

                      <div className="people-roster-field">
                        <span>Joined</span>
                        <strong>{fmtMelbourne(m.joined_at)}</strong>
                      </div>
                    </div>

                    <div className="people-roster-card__actions">
                      <label className="people-roster-test-toggle">
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
                        />
                        <span>Test account</span>
                      </label>

                      <div className="people-roster-action-buttons">
                        {displayNameDirty && (
                          <button
                            type="button"
                            className="ui-btn"
                            disabled={!displayNameDirty || saving || removing}
                            onClick={() => saveMember(m.user_id, { display_name: draft.display_name })}
                          >
                            {saving ? "Saving…" : "Save name"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="ui-btn people-roster-remove-btn"
                          disabled={saving || removing}
                          onClick={() => removeMember(m.user_id)}
                        >
                          {removing ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
        </>
      )}
    </main>
  );
}
