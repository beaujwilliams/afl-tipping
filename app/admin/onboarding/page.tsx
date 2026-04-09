"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  nextSuggestedOnboardingStage,
  normalizeOnboardingPipelineStage,
  type OnboardingPipelineStage,
} from "@/lib/onboarding-workflow";
import { NEXT_SEASON } from "@/lib/season-config";
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

type InterestStatus = "pending" | "notified" | "unsubscribed";
type DerivedStage =
  | "new"
  | "reviewed"
  | "contacted"
  | "invited"
  | "joined"
  | "payment_pending"
  | "active"
  | "archived";

type OnboardingRow = {
  id: string;
  target_season: number;
  email: string;
  full_name: string | null;
  status: InterestStatus;
  source: string;
  notes: string | null;
  submitted_at_utc: string;
  updated_at: string;
  pipeline_stage: OnboardingPipelineStage;
  derived_stage: DerivedStage;
  reviewed_at_utc?: string | null;
  contacted_at_utc?: string | null;
  invited_at_utc?: string | null;
  archived_at_utc?: string | null;
  archived_reason?: string | null;
  linked_user_id?: string | null;
  last_contact_note?: string | null;
  linked_member?: {
    user_id: string;
    display_name: string | null;
    email: string | null;
    payment_status: "paid" | "pending" | "waived" | null;
    role: string | null;
  } | null;
  suggested_link_member?: {
    user_id: string;
    display_name: string | null;
    email: string | null;
    payment_status: "paid" | "pending" | "waived" | null;
    role: string | null;
  } | null;
};

type OnboardingResponse = {
  ok?: boolean;
  season?: number;
  rows?: OnboardingRow[];
  summary?: Record<DerivedStage, number>;
  error?: string;
  details?: string;
};

type OnboardingPatchResponse = {
  ok?: boolean;
  row?: OnboardingRow | null;
  error?: string;
  details?: string;
};

type OnboardingInviteResponse = {
  ok?: boolean;
  row?: Partial<OnboardingRow> | null;
  invite_status?: string;
  provider_message_id?: string | null;
  error?: string;
  details?: string;
};

type RowDraft = {
  pipeline_stage: OnboardingPipelineStage;
  notes: string;
  last_contact_note: string;
  archived_reason: string;
};

type StageFilter = "all" | "needs_action" | DerivedStage;

const STAGE_OPTIONS: OnboardingPipelineStage[] = [
  "new",
  "reviewed",
  "contacted",
  "invited",
  "joined",
  "payment_pending",
  "active",
  "archived",
];

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

function stageTone(stage: DerivedStage) {
  if (stage === "active") return "success" as const;
  if (stage === "payment_pending") return "warning" as const;
  if (stage === "archived") return "neutral" as const;
  if (stage === "invited" || stage === "joined") return "info" as const;
  return "open" as const;
}

function paymentTone(status: "paid" | "pending" | "waived" | null) {
  if (status === "paid") return "success" as const;
  if (status === "waived") return "info" as const;
  if (status === "pending") return "warning" as const;
  return "neutral" as const;
}

function buildDraft(rows: OnboardingRow[]) {
  const out: Record<string, RowDraft> = {};
  rows.forEach((row) => {
    out[row.id] = {
      pipeline_stage: row.pipeline_stage,
      notes: row.notes ?? "",
      last_contact_note: row.last_contact_note ?? "",
      archived_reason: row.archived_reason ?? "",
    };
  });
  return out;
}

function deriveLastAction(row: OnboardingRow) {
  return (
    row.archived_at_utc ??
    row.invited_at_utc ??
    row.contacted_at_utc ??
    row.reviewed_at_utc ??
    row.updated_at ??
    row.submitted_at_utc
  );
}

export default function AdminOnboardingPage() {
  const toast = useToast();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [season, setSeason] = useState(NEXT_SEASON);
  const [rows, setRows] = useState<OnboardingRow[]>([]);
  const [summary, setSummary] = useState<Record<DerivedStage, number>>({
    new: 0,
    reviewed: 0,
    contacted: 0,
    invited: 0,
    joined: 0,
    payment_pending: 0,
    active: 0,
    archived: 0,
  });
  const [draftById, setDraftById] = useState<Record<string, RowDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("needs_action");
  const [msg, setMsg] = useState("");

  async function load(targetSeason = season) {
    setLoading(true);
    setMsg("");

    const { data: sessionData } = await supabaseBrowser.auth.getSession();
    const token = sessionData.session?.access_token ?? null;
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSessionToken(token);

    const res = await fetch(`/api/admin/onboarding?season=${encodeURIComponent(String(targetSeason))}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = (await res.json().catch(() => null)) as OnboardingResponse | null;
    setLoading(false);

    if (!res.ok || !json?.ok) {
      const detail = json?.details ? `: ${json.details}` : "";
      setMsg((json?.error ?? "Failed to load onboarding pipeline") + detail);
      return;
    }

    const nextRows = Array.isArray(json.rows) ? json.rows : [];
    setRows(nextRows);
    setDraftById(buildDraft(nextRows));
    setSummary({
      new: Number(json.summary?.new ?? 0),
      reviewed: Number(json.summary?.reviewed ?? 0),
      contacted: Number(json.summary?.contacted ?? 0),
      invited: Number(json.summary?.invited ?? 0),
      joined: Number(json.summary?.joined ?? 0),
      payment_pending: Number(json.summary?.payment_pending ?? 0),
      active: Number(json.summary?.active ?? 0),
      archived: Number(json.summary?.archived ?? 0),
    });
  }

  useEffect(() => {
    void load();
  }, [season]);

  function setDraftField(id: string, patch: Partial<RowDraft>) {
    setDraftById((prev) => ({
      ...prev,
      [id]: {
        pipeline_stage: patch.pipeline_stage ?? prev[id]?.pipeline_stage ?? "new",
        notes: patch.notes ?? prev[id]?.notes ?? "",
        last_contact_note: patch.last_contact_note ?? prev[id]?.last_contact_note ?? "",
        archived_reason: patch.archived_reason ?? prev[id]?.archived_reason ?? "",
      },
    }));
  }

  function recalculateSummary(nextRows: OnboardingRow[]) {
    const nextSummary: Record<DerivedStage, number> = {
      new: 0,
      reviewed: 0,
      contacted: 0,
      invited: 0,
      joined: 0,
      payment_pending: 0,
      active: 0,
      archived: 0,
    };
    nextRows.forEach((row) => {
      nextSummary[row.derived_stage] += 1;
    });
    setSummary(nextSummary);
  }

  async function patchRow(
    id: string,
    body: Partial<{
      pipeline_stage: OnboardingPipelineStage;
      notes: string;
      last_contact_note: string;
      archived_reason: string;
      linked_user_id: string | null;
      unlink_user: boolean;
    }>
  ) {
    if (!sessionToken) return;
    const res = await fetch("/api/admin/onboarding", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ id, ...body }),
    });

    const json = (await res.json().catch(() => null)) as OnboardingPatchResponse | null;
    if (!res.ok || !json?.ok || !json.row) {
      const detail = json?.details ? `: ${json.details}` : "";
      throw new Error((json?.error ?? "Failed to save onboarding row") + detail);
    }

    let nextRows: OnboardingRow[] = [];
    setRows((prev) => {
      nextRows = prev.map((row) => (row.id === id ? json.row ?? row : row));
      return nextRows;
    });
    setDraftById((prev) => ({
      ...prev,
      [id]: {
        pipeline_stage: json.row?.pipeline_stage ?? prev[id]?.pipeline_stage ?? "new",
        notes: json.row?.notes ?? "",
        last_contact_note: json.row?.last_contact_note ?? "",
        archived_reason: json.row?.archived_reason ?? "",
      },
    }));
    if (nextRows.length > 0) {
      recalculateSummary(nextRows);
    }
  }

  async function saveRow(id: string) {
    const draft = draftById[id];
    if (!draft) return;
    setSavingId(id);
    try {
      await patchRow(id, {
        pipeline_stage: draft.pipeline_stage,
        notes: draft.notes,
        last_contact_note: draft.last_contact_note,
        archived_reason: draft.archived_reason,
      });
      toast.success("Onboarding row updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save onboarding row");
    } finally {
      setSavingId(null);
    }
  }

  async function advanceRow(row: OnboardingRow) {
    const nextStage = nextSuggestedOnboardingStage(row.pipeline_stage);
    if (!nextStage) return;
    setSavingId(row.id);
    try {
      await patchRow(row.id, { pipeline_stage: nextStage });
      toast.success(`Moved to ${nextStage.replaceAll("_", " ")}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to advance stage");
    } finally {
      setSavingId(null);
    }
  }

  async function linkSuggestedMember(row: OnboardingRow) {
    const suggested = row.suggested_link_member;
    if (!suggested) return;
    setLinkingId(row.id);
    try {
      await patchRow(row.id, { linked_user_id: suggested.user_id });
      toast.success("Suggested member linked.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to link suggested member");
    } finally {
      setLinkingId(null);
    }
  }

  async function unlinkMember(row: OnboardingRow) {
    setLinkingId(row.id);
    try {
      await patchRow(row.id, { unlink_user: true });
      toast.success("Linked member removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to unlink member");
    } finally {
      setLinkingId(null);
    }
  }

  async function sendInvite(row: OnboardingRow) {
    setInvitingId(row.id);
    try {
      const res = await fetch(`/api/admin/onboarding/${encodeURIComponent(row.id)}/invite`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      const json = (await res.json().catch(() => null)) as OnboardingInviteResponse | null;
      if (!res.ok || !json?.ok) {
        const detail = json?.details ? `: ${json.details}` : "";
        throw new Error((json?.error ?? "Failed to send invite") + detail);
      }

      await load(season);
      toast.success(row.status === "notified" || row.pipeline_stage === "invited" ? "Invite resent." : "Invite sent.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send invite");
    } finally {
      setInvitingId(null);
    }
  }

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...rows]
      .filter((row) => {
        if (stageFilter === "needs_action") {
          if (!["new", "reviewed", "contacted", "invited", "payment_pending"].includes(row.derived_stage)) {
            return false;
          }
        } else if (stageFilter !== "all" && row.derived_stage !== stageFilter) {
          return false;
        }

        if (!needle) return true;
        return [
          row.full_name ?? "",
          row.email,
          row.notes ?? "",
          row.last_contact_note ?? "",
          row.source,
          row.linked_member?.display_name ?? "",
          row.suggested_link_member?.display_name ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => new Date(deriveLastAction(b)).getTime() - new Date(deriveLastAction(a)).getTime());
  }, [rows, search, stageFilter]);

  return (
    <main className="ui-page ui-page--wide ui-admin-page">
      <div className="ui-page-header">
        <div>
          <h1 className="ui-title">Onboarding Pipeline</h1>
          <div className="ui-caption ui-mt-1">
            Track new people from interest through invite, join, and payment readiness.
          </div>
        </div>
        <div className="ui-row-wrap">
          <UiButtonLink href="/admin">Back to admin</UiButtonLink>
          <UiButtonLink href="/admin/members">Roster &amp; Settings</UiButtonLink>
          <UiButtonLink href="/admin/payments">Payments</UiButtonLink>
          <UiButtonLink href="/admin/interested-members">Raw Interest Queue</UiButtonLink>
          <UiButton onClick={() => void load()}>{loading ? "Refreshing..." : "Refresh"}</UiButton>
        </div>
      </div>

      <UiCard soft className="ui-admin-section" style={{ marginTop: 12 }}>
        <UiSectionHeader
          title={`Season ${season} onboarding`}
          subtitle="Mainly for pre-season and late joins."
          right={
            <label className="ui-row-wrap">
              <span className="ui-caption">Season</span>
              <input
                className="ui-input"
                type="number"
                value={season}
                onChange={(e) => setSeason(Number(e.target.value))}
                style={{ width: 110 }}
              />
            </label>
          }
        />
      </UiCard>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        <UiCard soft onClick={() => setStageFilter("needs_action")} style={{ cursor: "pointer" }}>
          <div className="ui-caption">Needs action</div>
          <div className="ui-title--section" style={{ marginTop: 6 }}>
            {summary.new + summary.reviewed + summary.contacted + summary.invited + summary.payment_pending}
          </div>
        </UiCard>
        {([
          ["new", "New"],
          ["invited", "Invited"],
          ["payment_pending", "Payment pending"],
          ["active", "Active"],
          ["archived", "Archived"],
        ] as Array<[DerivedStage, string]>).map(([stage, label]) => (
          <UiCard key={stage} soft onClick={() => setStageFilter(stage)} style={{ cursor: "pointer" }}>
            <div className="ui-caption">{label}</div>
            <div className="ui-title--section" style={{ marginTop: 6 }}>
              {summary[stage]}
            </div>
          </UiCard>
        ))}
      </div>

      <UiCard soft style={{ marginTop: 12 }}>
        <div className="ui-row-wrap">
          <select
            className="ui-input"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as StageFilter)}
            style={{ width: 220 }}
          >
            <option value="needs_action">Needs action</option>
            <option value="all">All</option>
            <option value="new">New</option>
            <option value="reviewed">Reviewed</option>
            <option value="contacted">Contacted</option>
            <option value="invited">Invited</option>
            <option value="joined">Joined</option>
            <option value="payment_pending">Payment pending</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>

          <input
            className="ui-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, notes, linked member"
            style={{ minWidth: 260, flex: 1 }}
          />

          <UiButtonLink href="/admin/interested-members">Raw Interest Queue</UiButtonLink>
          <UiButtonLink href="/admin/payments">Payments</UiButtonLink>
          <UiButtonLink href="/admin/members">Roster &amp; Settings</UiButtonLink>
        </div>
      </UiCard>

      {msg && (
        <UiCard soft style={{ marginTop: 12 }}>
          <div className="ui-caption">{msg}</div>
        </UiCard>
      )}

      <UiTableShell style={{ marginTop: 12 }}>
        <UiTableScroll>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1320 }}>
            <thead>
              <tr>
                <UiTableHeadCell>Person</UiTableHeadCell>
                <UiTableHeadCell>Current outcome</UiTableHeadCell>
                <UiTableHeadCell>Pipeline stage</UiTableHeadCell>
                <UiTableHeadCell>Linked member</UiTableHeadCell>
                <UiTableHeadCell>Contact notes</UiTableHeadCell>
                <UiTableHeadCell>Admin notes</UiTableHeadCell>
                <UiTableHeadCell>Last action</UiTableHeadCell>
                <UiTableHeadCell>Actions</UiTableHeadCell>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <UiTableCell colSpan={8}>Loading onboarding pipeline…</UiTableCell>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <UiTableCell colSpan={8}>No onboarding rows match the current filters.</UiTableCell>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const draft = draftById[row.id] ?? {
                    pipeline_stage: row.pipeline_stage,
                    notes: row.notes ?? "",
                    last_contact_note: row.last_contact_note ?? "",
                    archived_reason: row.archived_reason ?? "",
                  };
                  const linked = !!row.linked_member;
                  const canInvite =
                    !linked &&
                    row.status !== "unsubscribed" &&
                    row.pipeline_stage !== "archived" &&
                    !row.archived_at_utc;
                  const inviteLabel =
                    row.status === "notified" || row.pipeline_stage === "invited"
                      ? "Resend invite"
                      : "Invite now";
                  const dirty =
                    draft.pipeline_stage !== row.pipeline_stage ||
                    draft.notes !== (row.notes ?? "") ||
                    draft.last_contact_note !== (row.last_contact_note ?? "") ||
                    draft.archived_reason !== (row.archived_reason ?? "");

                  return (
                    <tr key={row.id}>
                      <UiTableCell style={{ verticalAlign: "top" }}>
                        <div style={{ fontWeight: 800 }}>{row.full_name || row.email}</div>
                        <div className="ui-caption" style={{ marginTop: 4 }}>
                          {row.email}
                        </div>
                        <div className="ui-caption" style={{ marginTop: 4 }}>
                          Source: {row.source} · Legacy status: {row.status}
                        </div>
                        <div className="ui-caption" style={{ marginTop: 4 }}>
                          Submitted {fmtMelbourne(row.submitted_at_utc)}
                        </div>
                      </UiTableCell>

                      <UiTableCell style={{ verticalAlign: "top" }}>
                        <UiBadge tone={stageTone(row.derived_stage)}>
                          {row.derived_stage.replaceAll("_", " ")}
                        </UiBadge>
                      </UiTableCell>

                      <UiTableCell style={{ verticalAlign: "top" }}>
                        <select
                          className="ui-input"
                          value={draft.pipeline_stage}
                          disabled={linked}
                          onChange={(e) =>
                            setDraftField(row.id, {
                              pipeline_stage: normalizeOnboardingPipelineStage(e.target.value),
                            })
                          }
                          style={{ width: 170 }}
                        >
                          {STAGE_OPTIONS.map((stage) => (
                            <option key={stage} value={stage}>
                              {stage.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                        {linked && (
                          <div className="ui-caption" style={{ marginTop: 6 }}>
                            Linked rows derive their live outcome from membership/payment state.
                          </div>
                        )}
                      </UiTableCell>

                      <UiTableCell style={{ verticalAlign: "top" }}>
                        {row.linked_member ? (
                          <div className="ui-stack" style={{ gap: 6 }}>
                            <div style={{ fontWeight: 700 }}>
                              {row.linked_member.display_name || row.linked_member.email || row.linked_member.user_id}
                            </div>
                            {row.linked_member.email && (
                              <div className="ui-caption">{row.linked_member.email}</div>
                            )}
                            <div className="ui-row-wrap">
                              <UiBadge tone={paymentTone(row.linked_member.payment_status)}>
                                {row.linked_member.payment_status ?? "unknown"}
                              </UiBadge>
                              {row.linked_member.role && (
                                <UiBadge tone="neutral">{row.linked_member.role}</UiBadge>
                              )}
                            </div>
                          </div>
                        ) : row.suggested_link_member ? (
                          <div className="ui-stack" style={{ gap: 6 }}>
                            <div className="ui-caption">Suggested email match</div>
                            <div style={{ fontWeight: 700 }}>
                              {row.suggested_link_member.display_name ||
                                row.suggested_link_member.email ||
                                row.suggested_link_member.user_id}
                            </div>
                            {row.suggested_link_member.email && (
                              <div className="ui-caption">{row.suggested_link_member.email}</div>
                            )}
                            <UiBadge tone={paymentTone(row.suggested_link_member.payment_status)}>
                              {row.suggested_link_member.payment_status ?? "unknown"}
                            </UiBadge>
                          </div>
                        ) : (
                          <div className="ui-caption">No member link yet.</div>
                        )}
                      </UiTableCell>

                      <UiTableCell style={{ verticalAlign: "top" }}>
                        <textarea
                          className="ui-input"
                          value={draft.last_contact_note}
                          onChange={(e) => setDraftField(row.id, { last_contact_note: e.target.value })}
                          placeholder="Contact details or follow-up notes"
                          rows={3}
                          style={{ width: "100%", resize: "vertical" }}
                        />
                      </UiTableCell>

                      <UiTableCell style={{ verticalAlign: "top" }}>
                        <textarea
                          className="ui-input"
                          value={draft.notes}
                          onChange={(e) => setDraftField(row.id, { notes: e.target.value })}
                          placeholder="Admin notes"
                          rows={3}
                          style={{ width: "100%", resize: "vertical" }}
                        />
                        {draft.pipeline_stage === "archived" && !linked && (
                          <input
                            className="ui-input"
                            value={draft.archived_reason}
                            onChange={(e) => setDraftField(row.id, { archived_reason: e.target.value })}
                            placeholder="Archived reason"
                            style={{ width: "100%", marginTop: 8 }}
                          />
                        )}
                      </UiTableCell>

                      <UiTableCell style={{ verticalAlign: "top" }}>
                        <div className="ui-caption">{fmtMelbourne(deriveLastAction(row))}</div>
                        {row.reviewed_at_utc && (
                          <div className="ui-caption" style={{ marginTop: 4 }}>
                            Reviewed {fmtMelbourne(row.reviewed_at_utc)}
                          </div>
                        )}
                        {row.contacted_at_utc && (
                          <div className="ui-caption" style={{ marginTop: 4 }}>
                            Contacted {fmtMelbourne(row.contacted_at_utc)}
                          </div>
                        )}
                        {row.invited_at_utc && (
                          <div className="ui-caption" style={{ marginTop: 4 }}>
                            Invited {fmtMelbourne(row.invited_at_utc)}
                          </div>
                        )}
                      </UiTableCell>

                      <UiTableCell style={{ verticalAlign: "top" }}>
                        <div className="ui-stack" style={{ gap: 8 }}>
                          <UiButton
                            disabled={!dirty || savingId === row.id || linkingId === row.id}
                            onClick={() => void saveRow(row.id)}
                          >
                            {savingId === row.id ? "Saving..." : "Save"}
                          </UiButton>

                          {!linked && nextSuggestedOnboardingStage(row.pipeline_stage) && (
                            <UiButton
                              disabled={savingId === row.id || linkingId === row.id || invitingId === row.id}
                              onClick={() => void advanceRow(row)}
                            >
                              Advance
                            </UiButton>
                          )}

                          {canInvite && (
                            <UiButton
                              disabled={savingId === row.id || linkingId === row.id || invitingId === row.id}
                              onClick={() => void sendInvite(row)}
                            >
                              {invitingId === row.id ? "Sending..." : inviteLabel}
                            </UiButton>
                          )}

                          {!linked && row.suggested_link_member && (
                            <UiButton
                              disabled={savingId === row.id || linkingId === row.id || invitingId === row.id}
                              onClick={() => void linkSuggestedMember(row)}
                            >
                              {linkingId === row.id ? "Linking..." : "Link suggested member"}
                            </UiButton>
                          )}

                          {linked && (
                            <UiButton
                              tone="dangerSoft"
                              disabled={savingId === row.id || linkingId === row.id || invitingId === row.id}
                              onClick={() => void unlinkMember(row)}
                            >
                              {linkingId === row.id ? "Unlinking..." : "Unlink member"}
                            </UiButton>
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
    </main>
  );
}
