"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  UiButton,
  UiButtonLink,
  UiCard,
  UiTableCell,
  UiTableHeadCell,
  UiTableScroll,
  UiTableShell,
} from "@/components/ui";

type AuditRow = {
  id: string;
  competition_id: string;
  season: number | null;
  action_type: string;
  result_status: string;
  actor_mode: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  target_type: string | null;
  target_user_id: string | null;
  target_label: string | null;
  summary: string;
  request_path: string | null;
  details: unknown;
  created_at: string;
};

type AuditLogResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  hint?: string;
  rows?: AuditRow[];
};

function fmtMelbourne(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function actionLabel(actionType: string) {
  return actionType.replaceAll("_", " ");
}

export default function AdminAuditLogPage() {
  const [season, setSeason] = useState<number>(2026);
  const [status, setStatus] = useState("Checking login...");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [message, setMessage] = useState("Loading audit log...");
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  useEffect(() => {
    const rawSeason = new URLSearchParams(window.location.search).get("season");
    const parsedSeason = Number(rawSeason ?? "2026");
    if (Number.isFinite(parsedSeason)) {
      setSeason(parsedSeason);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabaseBrowser.auth.getUser();
      if (!alive) return;
      if (!data.user) {
        window.location.href = "/login";
        return;
      }
      setStatus("");
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function getToken() {
    const { data } = await supabaseBrowser.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function refresh() {
    try {
      setLoading(true);
      setMessage("Loading audit log...");

      const token = await getToken();
      if (!token) {
        setRows([]);
        setMessage("Not authenticated.");
        return;
      }

      const params = new URLSearchParams({
        season: String(season),
        limit: "100",
      });
      const res = await fetch(`/api/admin/audit-log?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = (await res.json().catch(() => null)) as AuditLogResponse | null;

      if (!res.ok || !json?.ok) {
        const parts = [json?.error ?? "Could not load audit log."];
        if (json?.details) parts.push(json.details);
        if (json?.hint) parts.push(json.hint);
        setRows([]);
        setMessage(parts.join(" - "));
        return;
      }

      const nextRows = Array.isArray(json.rows) ? json.rows : [];
      setRows(nextRows);
      setMessage(nextRows.length > 0 ? "" : "No admin actions recorded yet.");
    } catch (error: unknown) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : "Could not load audit log.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, season]);

  return (
    <main className="ui-page ui-page--narrow ui-admin-page">
      <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 10 }}>
        <h1 className="ui-title">Admin Audit Log</h1>
        <UiButtonLink href="/admin" className="ui-admin-btn">
          Back to Admin
        </UiButtonLink>
      </div>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      {!status && (
        <>
          <UiCard soft className="ui-admin-section">
            <div className="ui-row-wrap" style={{ justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div className="ui-admin-subtitle">What this log shows</div>
                <div className="ui-admin-summary ui-admin-summary--tight">
                  Manual admin actions that changed comp state: member edits, payment settings,
                  season winners, fixture syncs, result syncs, leaderboard recalcs, and due-round
                  odds snapshot checks.
                </div>
              </div>
              <div className="ui-row-wrap ui-admin-gap-sm">
                <input
                  type="number"
                  value={season}
                  onChange={(e) => setSeason(Number(e.target.value))}
                  className="ui-input ui-admin-input-season"
                />
                <UiButton
                  disabled={loading}
                  onClick={() => void refresh()}
                  className="ui-admin-btn ui-admin-btn--compact"
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </UiButton>
              </div>
            </div>
          </UiCard>

          <UiTableShell style={{ marginTop: 12 }}>
            <UiTableScroll>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
                <thead>
                  <tr>
                    <UiTableHeadCell>When</UiTableHeadCell>
                    <UiTableHeadCell>Admin</UiTableHeadCell>
                    <UiTableHeadCell>Action</UiTableHeadCell>
                    <UiTableHeadCell>Status</UiTableHeadCell>
                    <UiTableHeadCell>Target</UiTableHeadCell>
                    <UiTableHeadCell>Summary</UiTableHeadCell>
                    <UiTableHeadCell>Details</UiTableHeadCell>
                  </tr>
                </thead>
                <tbody>
                  {message ? (
                    <tr>
                      <UiTableCell colSpan={7}>{message}</UiTableCell>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id}>
                        <UiTableCell>{fmtMelbourne(row.created_at)}</UiTableCell>
                        <UiTableCell>
                          {row.actor_display_name || row.actor_user_id?.slice(0, 8) || "Unknown"}
                        </UiTableCell>
                        <UiTableCell>{actionLabel(row.action_type)}</UiTableCell>
                        <UiTableCell>{row.result_status}</UiTableCell>
                        <UiTableCell>{row.target_label || row.target_type || "—"}</UiTableCell>
                        <UiTableCell>{row.summary}</UiTableCell>
                        <UiTableCell>
                          <button
                            type="button"
                            className="ui-btn ui-btn--pill"
                            onClick={() => setOpenRowId((prev) => (prev === row.id ? null : row.id))}
                          >
                            {openRowId === row.id ? "Hide" : "View"}
                          </button>
                        </UiTableCell>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </UiTableScroll>
          </UiTableShell>

          {rows
            .filter((row) => openRowId === row.id)
            .map((row) => (
              <pre key={`audit-${row.id}`} className="ui-admin-result-pre" style={{ marginTop: 10 }}>
                {JSON.stringify(row.details, null, 2)}
              </pre>
            ))}
        </>
      )}
    </main>
  );
}
