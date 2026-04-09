"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useToast } from "@/components/ToastProvider";
import { CURRENT_SEASON } from "@/lib/season-config";
import {
  UiBadge,
  UiButton,
  UiButtonLink,
  UiCard,
  UiSectionHeader,
  UiTableCell,
  UiTableHeadCell,
  UiTableScroll,
  UiTableShell,
} from "@/components/ui";

type PaymentStatus = "unmatched" | "matched" | "ignored";
type PaymentMethod = "bank_transfer" | "payid" | "cash" | "other";

type MemberOption = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  payment_status: "paid" | "pending" | "waived" | null;
  role: string | null;
};

type PaymentSuggestion = MemberOption & {
  score: number;
  reasons: string[];
};

type PaymentOnboardingPreview = {
  id: string;
  email: string | null;
  full_name: string | null;
  derived_stage:
    | "new"
    | "reviewed"
    | "contacted"
    | "invited"
    | "joined"
    | "payment_pending"
    | "active"
    | "archived";
};

type PaymentRow = {
  id: string;
  season: number;
  amount_cents: number;
  payment_method: PaymentMethod;
  payer_name: string | null;
  payer_email: string | null;
  reference_text: string | null;
  notes: string | null;
  paid_at_utc: string;
  reconciliation_status: PaymentStatus;
  matched_user_id: string | null;
  matched_onboarding_id: string | null;
  matched_at_utc: string | null;
  created_at: string;
  updated_at: string;
  matched_member?: MemberOption | null;
  matched_onboarding?: PaymentOnboardingPreview | null;
  suggestions?: PaymentSuggestion[];
};

type PaymentsResponse = {
  ok?: boolean;
  season?: number;
  buy_in_cents?: number;
  summary?: {
    unmatched?: number;
    matched?: number;
    ignored?: number;
    total_amount_cents?: number;
    matched_amount_cents?: number;
  };
  rows?: PaymentRow[];
  member_options?: MemberOption[];
  hints?: {
    onboarding?: string | null;
  };
  error?: string;
  details?: string;
};

type PaymentPatchResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
};

type PaymentCreateResponse = {
  ok?: boolean;
  row?: PaymentRow;
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

function fmtMelbourne(iso: string | null | undefined) {
  if (!iso) return "—";
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

function fmtDollars(cents: number | null | undefined) {
  const value = Math.max(0, Math.round(Number(cents ?? 0)));
  return `$${(value / 100).toFixed(2)}`;
}

function paymentTone(status: PaymentStatus) {
  if (status === "matched") return "success" as const;
  if (status === "ignored") return "neutral" as const;
  return "warning" as const;
}

function memberPaymentTone(status: MemberOption["payment_status"]) {
  if (status === "paid") return "success" as const;
  if (status === "waived") return "info" as const;
  if (status === "pending") return "warning" as const;
  return "neutral" as const;
}

function onboardingTone(stage: PaymentOnboardingPreview["derived_stage"]) {
  if (stage === "active") return "success" as const;
  if (stage === "payment_pending") return "warning" as const;
  if (stage === "archived") return "neutral" as const;
  if (stage === "invited" || stage === "joined") return "info" as const;
  return "open" as const;
}

function toLocalDateTimeInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function memberLabel(member: MemberOption) {
  return member.display_name || member.email || member.user_id.slice(0, 8);
}

export default function AdminPaymentsPage() {
  const toast = useToast();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [season, setSeason] = useState(CURRENT_SEASON);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [summary, setSummary] = useState({
    unmatched: 0,
    matched: 0,
    ignored: 0,
    total_amount_cents: 0,
    matched_amount_cents: 0,
  });
  const [buyInCents, setBuyInCents] = useState(3000);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [matchChoiceById, setMatchChoiceById] = useState<Record<string, string>>({});
  const [actionId, setActionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sendingPaymentReminders, setSendingPaymentReminders] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "all">("unmatched");
  const [onboardingHint, setOnboardingHint] = useState<string>("");
  const [form, setForm] = useState({
    amount_dollars: "30.00",
    payment_method: "bank_transfer" as PaymentMethod,
    payer_name: "",
    payer_email: "",
    reference_text: "",
    notes: "",
    paid_at_local: toLocalDateTimeInput(new Date().toISOString()),
  });

  async function load(targetSeason = season) {
    setLoading(true);
    setMsg("");

    const { data } = await supabaseBrowser.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSessionToken(token);

    const res = await fetch(`/api/admin/payments?season=${encodeURIComponent(String(targetSeason))}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = (await res.json().catch(() => null)) as PaymentsResponse | null;
    setLoading(false);

    if (!res.ok || !json?.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      setMsg((json?.error ?? "Failed to load payments") + detail);
      return;
    }

    const nextRows = Array.isArray(json.rows) ? json.rows : [];
    setRows(nextRows);
    setMemberOptions(Array.isArray(json.member_options) ? json.member_options : []);
    setSummary({
      unmatched: Number(json.summary?.unmatched ?? 0),
      matched: Number(json.summary?.matched ?? 0),
      ignored: Number(json.summary?.ignored ?? 0),
      total_amount_cents: Number(json.summary?.total_amount_cents ?? 0),
      matched_amount_cents: Number(json.summary?.matched_amount_cents ?? 0),
    });
    setBuyInCents(Number(json.buy_in_cents ?? 3000));
    setOnboardingHint(typeof json.hints?.onboarding === "string" ? json.hints.onboarding : "");
    setMatchChoiceById((prev) => {
      const next = { ...prev };
      nextRows.forEach((row) => {
        if (!(row.id in next)) {
          next[row.id] = row.suggestions?.[0]?.user_id ?? "";
        }
      });
      return next;
    });
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.reconciliation_status !== statusFilter) return false;
      if (!needle) return true;
      const text = [
        row.payer_name,
        row.payer_email,
        row.reference_text,
        row.notes,
        row.matched_member?.display_name,
        row.matched_member?.email,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");
      return text.includes(needle);
    });
  }, [rows, search, statusFilter]);

  const sortedMemberOptions = useMemo(
    () => [...memberOptions].sort((a, b) => memberLabel(a).localeCompare(memberLabel(b))),
    [memberOptions]
  );

  async function createPayment() {
    if (!sessionToken) return;
    const amount = Number(form.amount_dollars);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid payment amount greater than 0.");
      return;
    }
    const paidAtUtc = fromLocalDateTimeInput(form.paid_at_local);
    if (!paidAtUtc) {
      toast.error("Enter a valid payment time.");
      return;
    }

    try {
      setCreating(true);
      const res = await fetch("/api/admin/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          season,
          amount_dollars: amount,
          payment_method: form.payment_method,
          payer_name: form.payer_name,
          payer_email: form.payer_email,
          reference_text: form.reference_text,
          notes: form.notes,
          paid_at_utc: paidAtUtc,
        }),
      });
      const json = (await res.json().catch(() => null)) as PaymentCreateResponse | null;
      if (!res.ok || !json?.ok) {
        const detail = json?.details ? `: ${json.details}` : "";
        throw new Error((json?.error ?? "Failed to record payment") + detail);
      }
      toast.success("Payment recorded.");
      setForm((prev) => ({
        ...prev,
        payer_name: "",
        payer_email: "",
        reference_text: "",
        notes: "",
        amount_dollars: (buyInCents / 100).toFixed(2),
      }));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record payment");
    } finally {
      setCreating(false);
    }
  }

  async function patchPayment(id: string, body: Record<string, unknown>, successMessage: string) {
    if (!sessionToken) return;
    try {
      setActionId(id);
      const res = await fetch(`/api/admin/payments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as PaymentPatchResponse | null;
      if (!res.ok || !json?.ok) {
        const detail = json?.details ? `: ${json.details}` : "";
        throw new Error((json?.error ?? "Failed to update payment record") + detail);
      }
      toast.success(successMessage);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update payment record");
    } finally {
      setActionId(null);
    }
  }

  async function sendPaymentReminders() {
    if (!sessionToken) return;
    const ok = confirm(
      `Send payment reminder emails now for season ${season}? This will contact members with payment status pending who have not already been sent this reminder this season.`
    );
    if (!ok) return;

    try {
      setSendingPaymentReminders(true);
      const res = await fetch(`/api/admin/send-payment-reminders?season=${season}`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as PaymentReminderSendResponse | null;
      if (!res.ok || !json?.ok) {
        const detail = json?.details ? `: ${json.details}` : "";
        throw new Error((json?.error ?? "Failed to send payment reminders") + detail);
      }

      const totals = json?.totals ?? {};
      toast.info(
        `Payment reminders: sent ${totals.sent ?? 0}. Already sent ${totals.skipped_already_sent ?? 0}. No email ${totals.no_email ?? 0}. Failed ${totals.failed ?? 0}.`,
        { durationMs: 5200 }
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send payment reminders");
    } finally {
      setSendingPaymentReminders(false);
    }
  }

  return (
    <main className="ui-page ui-page--wide ui-admin-page">
      <div className="ui-page-header">
        <div>
          <h1 className="ui-title">Payments</h1>
          <div className="ui-caption ui-mt-1">
            Record payments, match them to members, and confirm who is paid.
          </div>
        </div>
        <div className="ui-row-wrap">
          <UiButtonLink href="/admin">Back to admin</UiButtonLink>
          <UiButtonLink href="/admin/members">Roster &amp; Settings</UiButtonLink>
          <UiButtonLink href="/admin/onboarding">Onboarding</UiButtonLink>
          <UiButton onClick={() => void load()}>{loading ? "Refreshing..." : "Refresh"}</UiButton>
        </div>
      </div>

      <UiCard soft className="ui-admin-section" style={{ marginTop: 12 }}>
        <UiSectionHeader
          title={`Season ${season} payment ledger`}
          subtitle={`Buy-in: ${fmtDollars(buyInCents)}.`}
          right={
            <div className="ui-row-wrap">
              <label className="ui-admin-label">Season</label>
              <input
                type="number"
                min={2024}
                value={season}
                onChange={(e) =>
                  setSeason(Math.max(2024, Math.trunc(Number(e.target.value) || CURRENT_SEASON)))
                }
                className="ui-input ui-admin-input-season"
              />
            </div>
          }
        />
      </UiCard>

      <div className="ui-card-grid ui-card-grid--4 ui-mt-3">
        <UiCard soft onClick={() => setStatusFilter("unmatched")} style={{ cursor: "pointer" }}>
          <div className="ui-kicker">Needs match</div>
          <div className="ui-value">{summary.unmatched}</div>
          <div className="ui-meta">Unmatched payments awaiting reconciliation.</div>
        </UiCard>
        <UiCard soft onClick={() => setStatusFilter("matched")} style={{ cursor: "pointer" }}>
          <div className="ui-kicker">Matched</div>
          <div className="ui-value">{summary.matched}</div>
          <div className="ui-meta">{fmtDollars(summary.matched_amount_cents)} confirmed to members.</div>
        </UiCard>
        <UiCard soft onClick={() => setStatusFilter("all")} style={{ cursor: "pointer" }}>
          <div className="ui-kicker">Total recorded</div>
          <div className="ui-value">{fmtDollars(summary.total_amount_cents)}</div>
          <div className="ui-meta">All payment records for the selected season.</div>
        </UiCard>
        <UiCard soft onClick={() => setStatusFilter("ignored")} style={{ cursor: "pointer" }}>
          <div className="ui-kicker">Ignored</div>
          <div className="ui-value">{summary.ignored}</div>
          <div className="ui-meta">Transfers or entries parked outside the main queue.</div>
        </UiCard>
      </div>

      <UiCard soft style={{ marginTop: 12 }}>
        <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="ui-title--section">Payment follow-up</div>
            <div className="ui-caption ui-mt-1">
              Send reminders to members still marked pending.
            </div>
          </div>
          <UiButton
            disabled={sendingPaymentReminders}
            onClick={() => void sendPaymentReminders()}
            className="ui-admin-btn"
          >
            {sendingPaymentReminders ? "Sending..." : "Send Payment Pending Reminders"}
          </UiButton>
        </div>
      </UiCard>

      <UiCard soft style={{ marginTop: 12 }}>
        <div className="ui-title--section">Record payment</div>
        <div className="ui-caption ui-mt-1">
          Add the payment details. The app will suggest a member match.
        </div>
        <div
          className="ui-grid ui-mt-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
        >
          <label className="ui-stack">
            <span className="ui-caption">Amount (AUD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount_dollars}
              onChange={(e) => setForm((prev) => ({ ...prev, amount_dollars: e.target.value }))}
              className="ui-input"
            />
          </label>
          <label className="ui-stack">
            <span className="ui-caption">Method</span>
            <select
              value={form.payment_method}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, payment_method: e.target.value as PaymentMethod }))
              }
              className="ui-input"
            >
              <option value="bank_transfer">Bank transfer</option>
              <option value="payid">PayID</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="ui-stack">
            <span className="ui-caption">Paid at</span>
            <input
              type="datetime-local"
              value={form.paid_at_local}
              onChange={(e) => setForm((prev) => ({ ...prev, paid_at_local: e.target.value }))}
              className="ui-input"
            />
          </label>
          <label className="ui-stack">
            <span className="ui-caption">Payer name</span>
            <input
              type="text"
              value={form.payer_name}
              onChange={(e) => setForm((prev) => ({ ...prev, payer_name: e.target.value }))}
              className="ui-input"
              placeholder="Name shown by the bank"
            />
          </label>
          <label className="ui-stack">
            <span className="ui-caption">Payer email</span>
            <input
              type="email"
              value={form.payer_email}
              onChange={(e) => setForm((prev) => ({ ...prev, payer_email: e.target.value }))}
              className="ui-input"
              placeholder="If they emailed proof"
            />
          </label>
          <label className="ui-stack" style={{ gridColumn: "span 2" }}>
            <span className="ui-caption">Reference text</span>
            <input
              type="text"
              value={form.reference_text}
              onChange={(e) => setForm((prev) => ({ ...prev, reference_text: e.target.value }))}
              className="ui-input"
              placeholder="Bank reference / PayID description"
            />
          </label>
          <label className="ui-stack" style={{ gridColumn: "1 / -1" }}>
            <span className="ui-caption">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              className="ui-input"
              rows={3}
              placeholder="Optional admin context"
            />
          </label>
        </div>
        <div className="ui-row-wrap ui-mt-3">
          <UiButton disabled={creating} onClick={() => void createPayment()} className="ui-admin-btn">
            {creating ? "Recording..." : "Record payment"}
          </UiButton>
        </div>
      </UiCard>

      <UiCard soft style={{ marginTop: 12 }}>
        <div className="ui-row-wrap" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="ui-title--section">Reconciliation queue</div>
            <div className="ui-caption ui-mt-1">
              Match payments to members.
            </div>
          </div>
          <div className="ui-row-wrap">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search payer, reference, notes, or matched member"
              className="ui-input"
              style={{ minWidth: 320 }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as PaymentStatus | "all")}
              className="ui-input"
              style={{ maxWidth: 180 }}
            >
              <option value="all">All statuses</option>
              <option value="unmatched">Needs match</option>
              <option value="matched">Matched</option>
              <option value="ignored">Ignored</option>
            </select>
          </div>
        </div>
        {onboardingHint ? <div className="ui-caption ui-mt-2">{onboardingHint}</div> : null}
      </UiCard>

      {msg ? (
        <UiCard soft tone="danger" style={{ marginTop: 12 }}>
          {msg}
        </UiCard>
      ) : null}

      <UiTableShell style={{ marginTop: 12 }}>
        <UiTableScroll>
          <table className="ui-table ui-table--compact">
            <thead>
              <tr className="ui-table-head-row">
                <UiTableHeadCell>Payment</UiTableHeadCell>
                <UiTableHeadCell>Payer</UiTableHeadCell>
                <UiTableHeadCell>Status</UiTableHeadCell>
                <UiTableHeadCell>Suggestions</UiTableHeadCell>
                <UiTableHeadCell>Actions</UiTableHeadCell>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <UiTableCell colSpan={5}>Loading payments…</UiTableCell>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <UiTableCell colSpan={5}>No payment rows match the current filters.</UiTableCell>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const selectedUserId = matchChoiceById[row.id] ?? row.suggestions?.[0]?.user_id ?? "";
                  return (
                    <tr key={row.id}>
                      <UiTableCell>
                        <div className="ui-stack-tight">
                          <div style={{ fontWeight: 800 }}>{fmtDollars(row.amount_cents)}</div>
                          <div className="ui-caption">{row.payment_method.replace(/_/g, " ")}</div>
                          <div className="ui-caption">Paid {fmtMelbourne(row.paid_at_utc)}</div>
                          {row.reference_text ? <div className="ui-caption">Ref: {row.reference_text}</div> : null}
                          {row.notes ? <div className="ui-caption">{row.notes}</div> : null}
                        </div>
                      </UiTableCell>
                      <UiTableCell>
                        <div className="ui-stack-tight">
                          <div style={{ fontWeight: 700 }}>{row.payer_name || "Unknown payer"}</div>
                          {row.payer_email ? <div className="ui-caption">{row.payer_email}</div> : null}
                          <div className="ui-caption">Created {fmtMelbourne(row.created_at)}</div>
                        </div>
                      </UiTableCell>
                      <UiTableCell>
                        <div className="ui-stack-tight">
                          <UiBadge tone={paymentTone(row.reconciliation_status)}>
                            {row.reconciliation_status}
                          </UiBadge>
                          {row.matched_member ? (
                            <>
                              <div style={{ fontWeight: 700 }}>{memberLabel(row.matched_member)}</div>
                              <div className="ui-row-wrap">
                                <UiBadge tone={memberPaymentTone(row.matched_member.payment_status)}>
                                  {row.matched_member.payment_status ?? "unknown"}
                                </UiBadge>
                                {row.matched_member.role ? (
                                  <UiBadge tone="neutral">{row.matched_member.role}</UiBadge>
                                ) : null}
                              </div>
                              {row.matched_onboarding ? (
                                <div className="ui-row-wrap">
                                  <UiBadge tone={onboardingTone(row.matched_onboarding.derived_stage)}>
                                    onboarding {row.matched_onboarding.derived_stage}
                                  </UiBadge>
                                  <span className="ui-caption">
                                    {row.matched_onboarding.full_name || row.matched_onboarding.email || row.matched_onboarding.id}
                                  </span>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <div className="ui-caption">No member matched yet.</div>
                          )}
                        </div>
                      </UiTableCell>
                      <UiTableCell>
                        {row.matched_member ? (
                          <div className="ui-caption">Match locked in for this payment record.</div>
                        ) : row.reconciliation_status === "ignored" ? (
                          <div className="ui-caption">Ignored rows stay out of the active queue until reopened.</div>
                        ) : row.suggestions && row.suggestions.length > 0 ? (
                          <div className="ui-stack-tight">
                            {row.suggestions.map((suggestion) => (
                              <UiCard key={suggestion.user_id} className="ui-admin-tool ui-admin-tool--nested">
                                <div className="ui-row-wrap" style={{ justifyContent: "space-between" }}>
                                  <div>
                                    <div style={{ fontWeight: 700 }}>{memberLabel(suggestion)}</div>
                                    <div className="ui-caption">{suggestion.email || suggestion.user_id}</div>
                                  </div>
                                  <UiBadge tone={memberPaymentTone(suggestion.payment_status)}>
                                    {suggestion.payment_status ?? "unknown"}
                                  </UiBadge>
                                </div>
                                <div className="ui-caption ui-mt-1">{suggestion.reasons.join(" • ")}</div>
                                <div className="ui-row-wrap ui-mt-2">
                                  <UiButton
                                    disabled={actionId === row.id}
                                    onClick={() =>
                                      void patchPayment(
                                        row.id,
                                        { action: "match", user_id: suggestion.user_id },
                                        `Matched payment to ${memberLabel(suggestion)}.`
                                      )
                                    }
                                    className="ui-admin-btn ui-admin-btn--full"
                                  >
                                    Quick match
                                  </UiButton>
                                </div>
                              </UiCard>
                            ))}
                          </div>
                        ) : (
                          <div className="ui-caption">
                            No strong suggestions yet. Use the manual member selector in Actions.
                          </div>
                        )}
                      </UiTableCell>
                      <UiTableCell>
                        <div className="ui-stack-tight">
                          {!row.matched_member ? (
                            <>
                              <select
                                value={selectedUserId}
                                onChange={(e) =>
                                  setMatchChoiceById((prev) => ({ ...prev, [row.id]: e.target.value }))
                                }
                                className="ui-input"
                                style={{ minWidth: 220 }}
                              >
                                <option value="">Choose member…</option>
                                {sortedMemberOptions.map((member) => (
                                  <option key={member.user_id} value={member.user_id}>
                                    {memberLabel(member)}{member.email ? ` · ${member.email}` : ""}
                                  </option>
                                ))}
                              </select>
                              <UiButton
                                disabled={actionId === row.id || !selectedUserId}
                                onClick={() =>
                                  void patchPayment(
                                    row.id,
                                    { action: "match", user_id: selectedUserId },
                                    "Payment matched and member marked paid."
                                  )
                                }
                                className="ui-admin-btn ui-admin-btn--full"
                              >
                                {actionId === row.id ? "Saving..." : "Confirm match"}
                              </UiButton>
                              {row.reconciliation_status === "ignored" ? (
                                <UiButton
                                  disabled={actionId === row.id}
                                  onClick={() =>
                                    void patchPayment(
                                      row.id,
                                      { action: "reopen" },
                                      "Payment moved back into the active queue."
                                    )
                                  }
                                  className="ui-admin-btn ui-admin-btn--full"
                                >
                                  Reopen payment
                                </UiButton>
                              ) : (
                                <UiButton
                                  disabled={actionId === row.id}
                                  onClick={() =>
                                    void patchPayment(
                                      row.id,
                                      { action: "ignore" },
                                      "Payment moved out of the active queue."
                                    )
                                  }
                                  tone="dangerSoft"
                                  className="ui-admin-btn ui-admin-btn--full"
                                >
                                  Ignore for now
                                </UiButton>
                              )}
                            </>
                          ) : (
                            <div className="ui-caption">
                              If this match needs correction later, use Members to adjust payment status and record a fresh payment row for the right member.
                            </div>
                          )}
                        </div>
                      </UiTableCell>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </UiTableScroll>
      </UiTableShell>

      <UiCard soft style={{ marginTop: 12 }}>
        <div className="ui-caption">
          Practical workflow: record the transfer, use quick-match when the suggestion is clear, and
          fall back to the manual selector when the bank reference is messy. Linked onboarding rows
          for Season {season} will move to active once the matched member is paid.
        </div>
      </UiCard>
    </main>
  );
}
