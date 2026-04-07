import type {
  RoundPageOddsRow,
  RoundPagePaymentStatus,
  RoundPageRoundRow,
  RoundPageUserMembershipRow,
  RoundPageMemberRole,
} from "@/lib/round-page-data";

export function normalizeRoundPagePaymentStatus(
  status: string | null | undefined
): RoundPagePaymentStatus {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (s === "paid" || s === "pending" || s === "waived") return s;
  return "pending";
}

export function normalizeRoundPageRole(
  role: string | null | undefined
): RoundPageMemberRole {
  const r = String(role ?? "")
    .trim()
    .toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

export function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

export function pickRoundCandidate(
  roundCandidates: RoundPageRoundRow[],
  membershipByCompetition: Record<string, RoundPageUserMembershipRow>
) {
  const rolePriority = (competitionId: string) => {
    const role = normalizeRoundPageRole(
      membershipByCompetition[competitionId]?.role ?? null
    );
    if (role === "owner") return 0;
    if (role === "admin") return 1;
    if (role === "member") return 2;
    return 3;
  };

  return [...roundCandidates].sort((a, b) => {
    const roleDiff = rolePriority(a.competition_id) - rolePriority(b.competition_id);
    if (roleDiff !== 0) return roleDiff;
    return String(a.competition_id).localeCompare(String(b.competition_id));
  })[0] ?? null;
}

export function buildRoundPageOddsMap(rows: RoundPageOddsRow[]) {
  const map: Record<string, RoundPageOddsRow> = {};
  rows.forEach((row) => {
    if (!map[row.match_id]) map[row.match_id] = row;
  });
  return map;
}

export function computeRoundPagePaymentLock(params: {
  memberRole: RoundPageMemberRole;
  memberPaymentStatus: RoundPagePaymentStatus;
  enforceLock: boolean;
}) {
  return (
    params.enforceLock &&
    params.memberRole !== "owner" &&
    params.memberRole !== "admin" &&
    params.memberPaymentStatus === "pending"
  );
}
