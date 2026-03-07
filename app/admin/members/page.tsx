"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Member = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  payment_status: string | null;
  joined_at: string;
};

type MemberRole = "owner" | "admin" | "member";
type PaymentStatus = "paid" | "pending" | "waived";
type PaymentFilter = "all" | PaymentStatus;

type RowDraft = {
  display_name: string;
  role: MemberRole;
  payment_status: PaymentStatus;
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

  function buildDraft(rows: Member[]) {
    const out: Record<string, RowDraft> = {};
    rows.forEach((m) => {
      out[m.user_id] = {
        display_name: m.display_name ?? "",
        role: normalizeRole(m.role),
        payment_status: normalizePaymentStatus(m.payment_status),
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

  async function load() {
    setLoading(true);
    setMsg("");

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

    members.forEach((m) => {
      const status = normalizePaymentStatus(m.payment_status);
      if (status === "paid") paid += 1;
      else if (status === "waived") waived += 1;
      else pending += 1;
    });

    return {
      total: members.length,
      paid,
      pending,
      waived,
    };
  }, [members]);

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((m) => {
      const payment = normalizePaymentStatus(m.payment_status);
      if (paymentFilter !== "all" && payment !== paymentFilter) return false;

      if (!needle) return true;
      const role = normalizeRole(m.role);
      const name = (m.display_name ?? "").toLowerCase();
      const email = (m.email ?? "").toLowerCase();
      const uid = m.user_id.toLowerCase();
      return (
        name.includes(needle) ||
        email.includes(needle) ||
        uid.includes(needle) ||
        role.includes(needle) ||
        payment.includes(needle)
      );
    });
  }, [members, search, paymentFilter]);

  function setDraftField(userId: string, patch: Partial<RowDraft>) {
    setDraftById((prev) => ({
      ...prev,
      [userId]: {
        display_name: patch.display_name ?? prev[userId]?.display_name ?? "",
        role: patch.role ?? prev[userId]?.role ?? "member",
        payment_status: patch.payment_status ?? prev[userId]?.payment_status ?? "pending",
      },
    }));
  }

  async function saveMember(userId: string) {
    if (!sessionToken) return;
    const draft = draftById[userId];
    if (!draft) return;

    setSavingMemberId(userId);
    setMsg("");

    const res = await fetch("/api/admin/members", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        user_id: userId,
        display_name: draft.display_name,
        role: draft.role,
        payment_status: draft.payment_status,
      }),
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
              display_name: draft.display_name.trim() || null,
              role: draft.role,
              payment_status: draft.payment_status,
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

  const cardStyle: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 12,
    background: "var(--card-soft)",
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
            border: "1px solid #ccc",
            background: "white",
            fontWeight: 700,
          }}
        >
          Refresh
        </button>
      </div>

      <div style={{ marginTop: 14, ...cardStyle }}>
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
              border: "1px solid #ccc",
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

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Total</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24 }}>{counts.total}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Paid</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "#065f46" }}>{counts.paid}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Pending</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "#991b1b" }}>{counts.pending}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Waived</div>
          <div style={{ marginTop: 4, fontWeight: 900, fontSize: 24, color: "#5b21b6" }}>{counts.waived}</div>
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
            border: "1px solid #ccc",
          }}
        />
        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #ccc",
            background: "white",
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
        <div
          style={{
            marginTop: 14,
            border: "1px solid var(--border)",
            borderRadius: 14,
            overflow: "hidden",
            background: "var(--card)",
          }}
        >
          {filteredMembers.length === 0 ? (
            <div style={{ padding: 16, opacity: 0.75 }}>No matching members.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
                <thead>
                  <tr style={{ background: "var(--card-soft)", textAlign: "left", fontSize: 12 }}>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Name</th>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Email</th>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Role</th>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Payment</th>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Joined</th>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((m) => {
                    const draft = draftById[m.user_id] ?? {
                      display_name: m.display_name ?? "",
                      role: normalizeRole(m.role),
                      payment_status: normalizePaymentStatus(m.payment_status),
                    };

                    const saving = savingMemberId === m.user_id;
                    const removing = removingMemberId === m.user_id;

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
                              border: "1px solid #ccc",
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
                          </div>
                        </td>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)", fontSize: 13 }}>
                          {m.email ?? `${m.user_id.slice(0, 8)}…`}
                        </td>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
                          <select
                            value={draft.role}
                            onChange={(e) => setDraftField(m.user_id, { role: e.target.value as MemberRole })}
                            style={{
                              width: "100%",
                              padding: 9,
                              borderRadius: 9,
                              border: "1px solid #ccc",
                              background: "white",
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
                            value={draft.payment_status}
                            onChange={(e) =>
                              setDraftField(m.user_id, { payment_status: e.target.value as PaymentStatus })
                            }
                            style={{
                              width: "100%",
                              padding: 9,
                              borderRadius: 9,
                              border: "1px solid #ccc",
                              background: "white",
                              fontWeight: 700,
                            }}
                          >
                            <option value="paid">paid</option>
                            <option value="pending">pending</option>
                            <option value="waived">waived</option>
                          </select>
                        </td>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)", fontSize: 13 }}>
                          {fmtMelbourne(m.joined_at)}
                        </td>
                        <td style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              disabled={saving || removing}
                              onClick={() => saveMember(m.user_id)}
                              style={{
                                padding: "9px 10px",
                                borderRadius: 10,
                                border: "1px solid #ccc",
                                background: "white",
                                fontWeight: 800,
                                cursor: saving || removing ? "not-allowed" : "pointer",
                                opacity: saving || removing ? 0.7 : 1,
                              }}
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                            <button
                              disabled={saving || removing}
                              onClick={() => removeMember(m.user_id)}
                              style={{
                                padding: "9px 10px",
                                borderRadius: 10,
                                border: "1px solid #f3b",
                                background: "white",
                                fontWeight: 900,
                                cursor: saving || removing ? "not-allowed" : "pointer",
                                opacity: saving || removing ? 0.7 : 1,
                              }}
                            >
                              {removing ? "Removing…" : "Remove"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
