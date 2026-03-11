export type LeaderboardRankComparable = {
  total_points: number;
  accuracy_pct: number;
  correct_tips: number;
  display_name: string;
};

export type MembershipRole = "owner" | "admin" | "member";
export type PaymentStatus = "paid" | "pending" | "waived";

type WinningTipPointsInput = {
  pickedTeam: string;
  winnerTeam: string;
  homeTeam: string;
  awayTeam: string;
  homeOdds: number;
  awayOdds: number;
};

type PaymentLockInput = {
  enforceUnpaidTipLock: boolean;
  role: MembershipRole;
  paymentStatus: PaymentStatus;
};

export function leaderboardRankComparator(
  a: LeaderboardRankComparable,
  b: LeaderboardRankComparable
) {
  if (b.total_points !== a.total_points) return b.total_points - a.total_points;
  if (b.accuracy_pct !== a.accuracy_pct) return b.accuracy_pct - a.accuracy_pct;
  if (b.correct_tips !== a.correct_tips) return b.correct_tips - a.correct_tips;
  return a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" });
}

export function normalizeRole(role: string | null | undefined): MembershipRole {
  const r = String(role ?? "")
    .trim()
    .toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

export function normalizePaymentStatus(
  status: string | null | undefined
): PaymentStatus {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (s === "paid" || s === "pending" || s === "waived") return s;
  return "pending";
}

export function shouldBlockTipSubmissionForPayment({
  enforceUnpaidTipLock,
  role,
  paymentStatus,
}: PaymentLockInput) {
  if (!enforceUnpaidTipLock) return false;
  if (role === "owner" || role === "admin") return false;
  return paymentStatus === "pending";
}

export function isRoundLocked(lockTimeUtc: string | null, nowMs: number = Date.now()) {
  const lockMs = lockTimeUtc ? new Date(lockTimeUtc).getTime() : NaN;
  if (!Number.isFinite(lockMs)) return true;
  return nowMs >= lockMs;
}

export function pointsForWinningTip({
  pickedTeam,
  winnerTeam,
  homeTeam,
  awayTeam,
  homeOdds,
  awayOdds,
}: WinningTipPointsInput) {
  if (!pickedTeam || !winnerTeam || pickedTeam !== winnerTeam) return 0;
  if (winnerTeam === homeTeam) return Number(homeOdds ?? 0);
  if (winnerTeam === awayTeam) return Number(awayOdds ?? 0);
  return 0;
}
