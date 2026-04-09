"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiButton, UiCard, UiTableCell, UiTableHeadCell, UiTableScroll, UiTableShell } from "@/components/ui";
import { NEXT_SEASON } from "@/lib/season-config";

type InterestStatus = "pending" | "notified" | "unsubscribed";

type InterestRow = {
  id: string;
  target_season: number;
  email: string;
  full_name: string | null;
  status: InterestStatus;
  source: string;
  notes: string | null;
  submitted_at_utc: string;
  created_at: string;
  updated_at: string;
};

type InterestListResponse = {
  ok?: boolean;
  rows?: InterestRow[];
  error?: string;
  details?: string;
};

type InterestPatchResponse = {
  ok?: boolean;
  row?: InterestRow;
  error?: string;
  details?: string;
};

type InterestDeleteResponse = {
  ok?: boolean;
  id?: string;
  error?: string;
  details?: string;
};

type BulkSeasonOpenResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  recipients_targeted?: number;
  totals?: {
    sent?: number;
    simulated?: number;
    failed?: number;
  };
};

type RowDraft = {
  status: InterestStatus;
  notes: string;
};

function normalizeStatus(raw: string | null | undefined): InterestStatus {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "pending" || value === "notified" || value === "unsubscribed") {
    return value;
  }
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

function toCsv(rows: InterestRow[]) {
  const header = ["email", "full_name", "status", "source", "submitted_at_utc", "notes"];
  const body = rows.map((r) => [
    r.email ?? "",
    r.full_name ?? "",
    r.status ?? "",
    r.source ?? "",
    r.submitted_at_utc ?? "",
    r.notes ?? "",
  ]);
  const all = [header, ...body];
  return all
    .map((line) =>
      line
        .map((cell) => {
          const safe = String(cell ?? "");
          if (safe.includes(",") || safe.includes("\"") || safe.includes("\n")) {
            return `"${safe.replaceAll("\"", "\"\"")}"`;
          }
          return safe;
        })
        .join(",")
    )
    .join("\n");
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminInterestedMembersPage() {
  const toast = useToast();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [season, setSeason] = useState<number>(NEXT_SEASON);
  const [statusFilter, setStatusFilter] = useState<"all" | InterestStatus>("all");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<InterestRow[]>([]);
  const [draftById, setDraftById] = useState<Record<string, RowDraft>>({});

  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [msg, setMsg] = useState("");

  function buildDraft(nextRows: InterestRow[]) {
    const out: Record<string, RowDraft> = {};
    nextRows.forEach((row) => {
      out[row.id] = {
        status: normalizeStatus(row.status),
        notes: row.notes ?? "",
      };
    });
    return out;
  }

  async function fetchInterestList(token: string, targetSeason: number, targetStatus: "all" | InterestStatus) {
    const params = new URLSearchParams({
      season: String(targetSeason),
      limit: "1000",
    });
    if (targetStatus !== "all") params.set("status", targetStatus);

    const res = await fetch(`/api/admin/next-season-interest?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = (await res.json().catch(() => null)) as InterestListResponse | null;
    return { res, json };
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

    const { res, json } = await fetchInterestList(token, season, statusFilter);
    setLoading(false);

    if (!res.ok || !json?.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      setMsg((json?.error ?? "Failed to load interest list") + detail);
      return;
    }

    const nextRows = Array.isArray(json.rows) ? json.rows : [];
    setRows(nextRows);
    setDraftById(buildDraft(nextRows));
  }

  useEffect(() => {
    let active = true;

    async function init() {
      const { data: sessionData } = await supabaseBrowser.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      if (!token) {
        window.location.href = "/login";
        return;
      }
      if (!active) return;

      setSessionToken(token);
      setLoading(true);
      setMsg("");

      const { res, json } = await fetchInterestList(token, season, statusFilter);
      if (!active) return;
      setLoading(false);

      if (!res.ok || !json?.ok) {
        const detail = json?.details ? `: ${json.details}` : "";
        setMsg((json?.error ?? "Failed to load interest list") + detail);
        return;
      }

      const nextRows = Array.isArray(json.rows) ? json.rows : [];
      setRows(nextRows);
      setDraftById(buildDraft(nextRows));
    }

    void init();

    return () => {
      active = false;
    };
  }, [season, statusFilter]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const name = String(row.full_name ?? "").toLowerCase();
      const email = String(row.email ?? "").toLowerCase();
      const notes = String(row.notes ?? "").toLowerCase();
      const source = String(row.source ?? "").toLowerCase();
      return (
        name.includes(needle) ||
        email.includes(needle) ||
        notes.includes(needle) ||
        source.includes(needle)
      );
    });
  }, [rows, search]);

  const counts = useMemo(() => {
    let pending = 0;
    let notified = 0;
    let unsubscribed = 0;
    rows.forEach((row) => {
      const status = normalizeStatus(row.status);
      if (status === "pending") pending += 1;
      else if (status === "notified") notified += 1;
      else unsubscribed += 1;
    });
    return {
      total: rows.length,
      pending,
      notified,
      unsubscribed,
    };
  }, [rows]);

  function setDraftField(id: string, patch: Partial<RowDraft>) {
    setDraftById((prev) => ({
      ...prev,
      [id]: {
        status: patch.status ?? prev[id]?.status ?? "pending",
        notes: patch.notes ?? prev[id]?.notes ?? "",
      },
    }));
  }

  async function saveRow(id: string) {
    if (!sessionToken) return;
    const draft = draftById[id];
    if (!draft) return;

    setSavingId(id);
    setMsg("");

    const res = await fetch("/api/admin/next-season-interest", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        id,
        status: draft.status,
        notes: draft.notes,
      }),
    });

    const json = (await res.json().catch(() => null)) as InterestPatchResponse | null;
    setSavingId(null);

    if (!res.ok || !json?.ok || !json.row) {
      const detail = json?.details ? `: ${json.details}` : "";
      toast.error((json?.error ?? "Failed to save row") + detail);
      return;
    }

    setRows((prev) => prev.map((row) => (row.id === id ? json.row ?? row : row)));
    toast.success("Interested member updated.");
  }

  async function deleteRow(id: string) {
    if (!sessionToken) return;
    const ok = confirm("Delete this interested member? This cannot be undone.");
    if (!ok) return;

    setDeletingId(id);
    setMsg("");

    const res = await fetch("/api/admin/next-season-interest", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ id }),
    });

    const json = (await res.json().catch(() => null)) as InterestDeleteResponse | null;
    setDeletingId(null);

    if (!res.ok || !json?.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      toast.error((json?.error ?? "Failed to delete row") + detail);
      return;
    }

    setRows((prev) => prev.filter((row) => row.id !== id));
    setDraftById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    toast.success("Interested member deleted.");
  }

  async function sendSeasonOpenBulkEmail() {
    if (!sessionToken) return;
    const ok = confirm(
      `Send season-open email to all pending interested members for season ${season}? Successful sends will be marked as notified.`
    );
    if (!ok) return;

    setSendingBulk(true);
    setMsg("");

    const res = await fetch("/api/admin/next-season-interest/send-season-open", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ season }),
    });

    const json = (await res.json().catch(() => null)) as BulkSeasonOpenResponse | null;
    setSendingBulk(false);

    if (!res.ok || !json?.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      toast.error((json?.error ?? "Failed to send bulk email") + detail);
      return;
    }

    const totals = json.totals ?? {};
    const summary = `Season-open email run complete. Targeted ${json.recipients_targeted ?? 0}, sent ${totals.sent ?? 0}, failed ${totals.failed ?? 0}.`;
    await load();
    toast.info(summary, { durationMs: 5200 });
  }

  function exportCsv() {
    const csv = toCsv(filteredRows);
    downloadCsv(`next-season-interest-${season}.csv`, csv);
  }

  return (
    <main className="ui-page ui-page--wide">
      <div className="ui-row-between">
        <div>
          <h1 className="ui-title" style={{ margin: 0 }}>
            Raw Interest Queue
          </h1>
          <div className="ui-caption" style={{ marginTop: 6 }}>
            Back-office waitlist view for export, bulk email, and cleanup. Follow-up lives in
            onboarding.
          </div>
        </div>
        <div className="ui-row-wrap">
          <Link href="/admin" className="ui-btn" style={{ padding: "10px 12px" }}>
            Back to admin
          </Link>
          <UiButton onClick={load} style={{ padding: "10px 12px" }}>
            Refresh
          </UiButton>
        </div>
      </div>

      <UiCard soft style={{ marginTop: 12 }}>
        <div className="ui-row-wrap" style={{ gap: 10 }}>
          <label className="ui-caption">Season</label>
          <input
            className="ui-input"
            type="number"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            style={{ width: 110 }}
          />

          <label className="ui-caption">Status</label>
          <select
            className="ui-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | InterestStatus)}
            style={{ width: 160 }}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="notified">Notified</option>
            <option value="unsubscribed">Unsubscribed</option>
          </select>

          <input
            className="ui-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name/email/notes"
            style={{ minWidth: 260, flex: 1 }}
          />

          <UiButton onClick={exportCsv}>Export CSV</UiButton>
          <UiButton
            disabled={sendingBulk || loading || counts.pending === 0}
            onClick={sendSeasonOpenBulkEmail}
            tone="activeSuccess"
          >
            {sendingBulk ? "Sending..." : `Email Pending (${counts.pending})`}
          </UiButton>
        </div>

        <div className="ui-row-wrap" style={{ marginTop: 10 }}>
          <span className="ui-caption">Total: {counts.total}</span>
          <span className="ui-caption">Pending: {counts.pending}</span>
          <span className="ui-caption">Notified: {counts.notified}</span>
          <span className="ui-caption">Unsubscribed: {counts.unsubscribed}</span>
        </div>
      </UiCard>

      {msg && (
        <UiCard soft style={{ marginTop: 12 }}>
          <div className="ui-caption">{msg}</div>
        </UiCard>
      )}

      <UiTableShell style={{ marginTop: 12 }}>
        <UiTableScroll>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1020 }}>
            <thead>
              <tr>
                <UiTableHeadCell>Email</UiTableHeadCell>
                <UiTableHeadCell>Name</UiTableHeadCell>
                <UiTableHeadCell>Status</UiTableHeadCell>
                <UiTableHeadCell>Submitted</UiTableHeadCell>
                <UiTableHeadCell>Source</UiTableHeadCell>
                <UiTableHeadCell>Notes</UiTableHeadCell>
                <UiTableHeadCell>Actions</UiTableHeadCell>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <UiTableCell colSpan={7}>Loading interest list…</UiTableCell>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <UiTableCell colSpan={7}>No interested members found.</UiTableCell>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const draft = draftById[row.id] ?? {
                    status: normalizeStatus(row.status),
                    notes: row.notes ?? "",
                  };

                  const dirty = draft.status !== row.status || draft.notes !== (row.notes ?? "");

                  return (
                    <tr key={row.id}>
                      <UiTableCell>
                        <div style={{ fontWeight: 700 }}>{row.email}</div>
                      </UiTableCell>
                      <UiTableCell>{row.full_name || "—"}</UiTableCell>
                      <UiTableCell>
                        <select
                          className="ui-input"
                          value={draft.status}
                          onChange={(e) => setDraftField(row.id, { status: normalizeStatus(e.target.value) })}
                          style={{ width: 140 }}
                        >
                          <option value="pending">Pending</option>
                          <option value="notified">Notified</option>
                          <option value="unsubscribed">Unsubscribed</option>
                        </select>
                      </UiTableCell>
                      <UiTableCell>{fmtMelbourne(row.submitted_at_utc)}</UiTableCell>
                      <UiTableCell>{row.source}</UiTableCell>
                      <UiTableCell>
                        <input
                          className="ui-input"
                          value={draft.notes}
                          onChange={(e) => setDraftField(row.id, { notes: e.target.value })}
                          placeholder="Optional notes"
                          style={{ width: "100%" }}
                          maxLength={2000}
                        />
                      </UiTableCell>
                      <UiTableCell>
                        <div style={{ display: "flex", gap: 8 }}>
                          <UiButton
                            disabled={!dirty || savingId === row.id || deletingId === row.id}
                            onClick={() => saveRow(row.id)}
                            style={{ width: 92 }}
                          >
                            {savingId === row.id ? "Saving..." : "Save"}
                          </UiButton>
                          <UiButton
                            disabled={savingId === row.id || deletingId === row.id}
                            onClick={() => deleteRow(row.id)}
                            tone="dangerSoft"
                            style={{ width: 92 }}
                          >
                            {deletingId === row.id ? "Deleting..." : "Delete"}
                          </UiButton>
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

      <details
        style={{
          marginTop: 16,
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 12,
          background: "var(--card-soft)",
        }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>
          Re-Open Sign Ups Instructions
        </summary>

        <div style={{ marginTop: 12, display: "grid", gap: 10, fontSize: 14, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700 }}>1) Enable app signup UI (Vercel)</div>
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            <li>Open Vercel project settings.</li>
            <li>Go to Environment Variables.</li>
            <li>Set <code>NEXT_PUBLIC_SIGNUPS_OPEN=true</code>.</li>
            <li>Confirm <code>NEXT_PUBLIC_CURRENT_SEASON</code> is correct.</li>
            <li>Redeploy production.</li>
          </ol>

          <div style={{ fontWeight: 700 }}>2) Enable account creation hard lock (Supabase Auth)</div>
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            <li>Open Supabase project.</li>
            <li>Go to Authentication, then Sign In / Providers.</li>
            <li>Turn ON <b>Allow new users to sign up</b>.</li>
            <li>Save changes.</li>
          </ol>

          <div style={{ fontWeight: 700 }}>3) Verify it works safely</div>
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            <li>Existing member can still sign in and tip.</li>
            <li><code>/signup</code> allows new account creation.</li>
            <li>New account receives confirmation email and can complete setup.</li>
          </ol>

          <div className="ui-caption">
            If you need to close signups again: set <code>NEXT_PUBLIC_SIGNUPS_OPEN=false</code>,
            redeploy, then turn OFF <b>Allow new users to sign up</b> in Supabase Auth.
          </div>
        </div>
      </details>
    </main>
  );
}
