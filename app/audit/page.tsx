"use client";

import { useEffect, useMemo, useState } from "react";
import { UiButton, UiCard, UiSectionHeader } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { CURRENT_SEASON } from "@/lib/season-config";
import { waitForSession } from "@/lib/session-client";

type AuditRoundOption = {
  round_number: number;
  lock_time_utc: string;
};

type AuditMemberOption = {
  user_id: string;
  display_name: string;
};

type AuditOptionsResponse = {
  ok?: boolean;
  season?: number;
  locked_rounds?: AuditRoundOption[];
  members?: AuditMemberOption[];
  error?: string;
};

type DownloadScope = "all" | "round" | "users";

function parseFileNameFromDisposition(disposition: string | null) {
  if (!disposition) return null;
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? null;
}

export default function AuditPage() {
  const toast = useToast();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [season, setSeason] = useState<number>(CURRENT_SEASON);
  const [loadingOptions, setLoadingOptions] = useState<boolean>(true);
  const [downloadingScope, setDownloadingScope] = useState<DownloadScope | null>(null);
  const [error, setError] = useState<string>("");
  const [rounds, setRounds] = useState<AuditRoundOption[]>([]);
  const [members, setMembers] = useState<AuditMemberOption[]>([]);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const selectedUsersSummary = useMemo(() => {
    if (selectedUserIds.length === 0) return "No users selected";
    if (selectedUserIds.length === 1) return "1 user selected";
    return `${selectedUserIds.length} users selected`;
  }, [selectedUserIds]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const session = await waitForSession(2500, 180);
      const token = session?.access_token ?? null;

      if (!token) {
        window.location.href = "/login";
        return;
      }
      if (cancelled) return;

      setSessionToken(token);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadOptions(token: string, targetSeason: number) {
    setLoadingOptions(true);
    setError("");

    try {
      const res = await fetch(
        `/api/audit/options?season=${encodeURIComponent(String(targetSeason))}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const json = (await res.json().catch(() => null)) as AuditOptionsResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to load audit options");
      }

      const nextRounds = Array.isArray(json.locked_rounds) ? json.locked_rounds : [];
      const nextMembers = Array.isArray(json.members) ? json.members : [];

      setRounds(nextRounds);
      setMembers(nextMembers);
      setSelectedUserIds((prev) =>
        prev.filter((userId) => nextMembers.some((member) => member.user_id === userId))
      );
      setSelectedRound((prev) => {
        if (typeof prev === "number" && nextRounds.some((round) => round.round_number === prev)) {
          return prev;
        }
        if (nextRounds.length === 0) return null;
        return nextRounds[nextRounds.length - 1].round_number;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load audit options";
      setError(message);
      setRounds([]);
      setMembers([]);
      setSelectedRound(null);
      setSelectedUserIds([]);
    } finally {
      setLoadingOptions(false);
    }
  }

  useEffect(() => {
    if (!sessionToken) return;
    void loadOptions(sessionToken, season);
  }, [sessionToken, season]);

  async function downloadCsv(scope: DownloadScope) {
    if (!sessionToken) return;

    if (scope === "round" && (selectedRound === null || !Number.isFinite(selectedRound))) {
      toast.error("Pick a locked round first.");
      return;
    }
    if (scope === "users" && selectedUserIds.length === 0) {
      toast.error("Select at least one user.");
      return;
    }

    setDownloadingScope(scope);
    setError("");

    try {
      const qs = new URLSearchParams();
      qs.set("season", String(season));
      qs.set("scope", scope);
      if (scope === "round" && selectedRound !== null) {
        qs.set("round", String(selectedRound));
      }
      if (scope === "users") {
        selectedUserIds.forEach((userId) => qs.append("user_id", userId));
      }

      const res = await fetch(`/api/audit/export?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? "Failed to download audit CSV");
      }

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const fileName =
        parseFileNameFromDisposition(res.headers.get("content-disposition")) ??
        `audit-${scope}-${season}.csv`;

      const a = document.createElement("a");
      a.href = href;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);

      toast.success("Audit CSV downloaded.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to download audit CSV";
      setError(message);
      toast.error(message);
    } finally {
      setDownloadingScope(null);
    }
  }

  return (
    <main className="ui-page ui-page--content">
      <UiSectionHeader
        title="Audit"
        subtitle="Download Excel-friendly CSV exports for locked-round tip history."
      />

      <UiCard soft style={{ marginTop: 12 }}>
        <div className="ui-row-wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="ui-caption">
            Includes final pick, first/last submission timestamps, lock time, and post-lock change flag.
          </div>
          <div className="ui-row-wrap" style={{ alignItems: "center" }}>
            <label className="ui-caption">Season</label>
            <input
              type="number"
              min={2024}
              value={season}
              onChange={(e) => {
                const value = Math.trunc(Number(e.target.value) || CURRENT_SEASON);
                setSeason(Math.max(2024, value));
              }}
              className="ui-input"
              style={{ maxWidth: 130 }}
            />
            <UiButton
              onClick={() => {
                if (!sessionToken) return;
                void loadOptions(sessionToken, season);
              }}
              disabled={loadingOptions}
            >
              {loadingOptions ? "Loading..." : "Refresh"}
            </UiButton>
          </div>
        </div>
      </UiCard>

      {error ? (
        <UiCard soft tone="danger" style={{ marginTop: 12 }}>
          {error}
        </UiCard>
      ) : null}

      <div className="ui-card-grid ui-card-grid--3 ui-mt-3">
        <UiCard soft>
          <div className="ui-title--section">All Data</div>
          <div className="ui-caption ui-mt-1">Every locked-round tip entry for the selected season.</div>
          <div className="ui-mt-3">
            <UiButton
              onClick={() => void downloadCsv("all")}
              disabled={loadingOptions || downloadingScope !== null}
              className="ui-admin-btn"
            >
              {downloadingScope === "all" ? "Downloading..." : "Download all CSV"}
            </UiButton>
          </div>
        </UiCard>

        <UiCard soft>
          <div className="ui-title--section">Single Round</div>
          <div className="ui-caption ui-mt-1">Export one locked round.</div>
          <div className="ui-stack ui-mt-3">
            <label className="ui-caption" htmlFor="audit-round-select">
              Round
            </label>
            <select
              id="audit-round-select"
              value={selectedRound === null ? "" : String(selectedRound)}
              onChange={(e) => {
                const value = Number(e.target.value);
                setSelectedRound(Number.isFinite(value) ? value : null);
              }}
              className="ui-input"
              disabled={loadingOptions || rounds.length === 0}
            >
              {rounds.length === 0 ? (
                <option value="">No locked rounds</option>
              ) : (
                rounds.map((round) => (
                  <option key={round.round_number} value={round.round_number}>
                    Round {round.round_number}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="ui-mt-3">
            <UiButton
              onClick={() => void downloadCsv("round")}
              disabled={loadingOptions || downloadingScope !== null || rounds.length === 0}
              className="ui-admin-btn"
            >
              {downloadingScope === "round" ? "Downloading..." : "Download round CSV"}
            </UiButton>
          </div>
        </UiCard>

        <UiCard soft>
          <div className="ui-title--section">User History</div>
          <div className="ui-caption ui-mt-1">Export locked-round data for selected users.</div>
          <div className="ui-stack ui-mt-3">
            <label className="ui-caption" htmlFor="audit-users-select">
              Users (multi-select)
            </label>
            <select
              id="audit-users-select"
              className="ui-input"
              multiple
              size={8}
              value={selectedUserIds}
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions).map((option) => option.value);
                setSelectedUserIds(values);
              }}
              disabled={loadingOptions || members.length === 0}
              style={{ minHeight: 190 }}
            >
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-caption ui-mt-2">{selectedUsersSummary}</div>
          <div className="ui-row-wrap ui-mt-2">
            <UiButton
              onClick={() => setSelectedUserIds(members.map((member) => member.user_id))}
              disabled={loadingOptions || members.length === 0}
            >
              Select all
            </UiButton>
            <UiButton onClick={() => setSelectedUserIds([])} disabled={selectedUserIds.length === 0}>
              Clear
            </UiButton>
          </div>
          <div className="ui-mt-3">
            <UiButton
              onClick={() => void downloadCsv("users")}
              disabled={loadingOptions || downloadingScope !== null || selectedUserIds.length === 0}
              className="ui-admin-btn"
            >
              {downloadingScope === "users" ? "Downloading..." : "Download users CSV"}
            </UiButton>
          </div>
        </UiCard>
      </div>
    </main>
  );
}
