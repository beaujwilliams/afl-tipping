export type RoundTipStatusPlayer = {
  user_id: string;
  display_name: string | null;
  payment_status: string | null;
  tips_entered: number;
  latest_submitted_at_utc?: string | null;
  last_reminded_at_utc?: string | null;
};

export function roundTipStatusPlayerComparator(
  a: Pick<RoundTipStatusPlayer, "user_id" | "display_name">,
  b: Pick<RoundTipStatusPlayer, "user_id" | "display_name">
) {
  const aName = String(a.display_name ?? "").trim();
  const bName = String(b.display_name ?? "").trim();

  if (aName && bName) {
    const cmp = aName.localeCompare(bName, "en", { sensitivity: "base" });
    if (cmp !== 0) return cmp;
  } else if (aName) {
    return -1;
  } else if (bName) {
    return 1;
  }

  return String(a.user_id).localeCompare(String(b.user_id));
}

export function buildRoundTipStatusPlayerLists(params: {
  memberIds: string[];
  totalMatches: number;
  profileNameByUserId: Map<string, string | null>;
  paymentStatusByUserId: Map<string, string | null>;
  tipCountByUserId?: Map<string, number>;
  latestSubmittedAtByUserId?: Map<string, string>;
  lastReminderAtByUserId?: Map<string, string>;
}) {
  const tipsByUser = params.tipCountByUserId ?? new Map<string, number>();
  const latestSubmittedAtByUserId =
    params.latestSubmittedAtByUserId ?? new Map<string, string>();
  const lastReminderAtByUserId = params.lastReminderAtByUserId ?? new Map<string, string>();
  const hasCompletedTips = (userId: string) =>
    params.totalMatches > 0 && (tipsByUser.get(userId) ?? 0) >= params.totalMatches;

  const missingPlayers: RoundTipStatusPlayer[] = [];
  const tippedPlayers: RoundTipStatusPlayer[] = [];

  for (const userId of params.memberIds) {
    const row: RoundTipStatusPlayer = {
      user_id: userId,
      display_name: params.profileNameByUserId.get(userId) ?? null,
      payment_status: params.paymentStatusByUserId.get(userId) ?? null,
      tips_entered: Math.min(tipsByUser.get(userId) ?? 0, params.totalMatches),
      latest_submitted_at_utc: latestSubmittedAtByUserId.get(userId) ?? null,
      last_reminded_at_utc: lastReminderAtByUserId.get(userId) ?? null,
    };

    if (hasCompletedTips(userId)) tippedPlayers.push(row);
    else missingPlayers.push(row);
  }

  const timestampDesc = (aIso?: string | null, bIso?: string | null) => {
    const aMs = aIso ? Date.parse(aIso) : Number.NaN;
    const bMs = bIso ? Date.parse(bIso) : Number.NaN;
    const aValid = Number.isFinite(aMs);
    const bValid = Number.isFinite(bMs);
    if (aValid && bValid) return bMs - aMs;
    if (aValid) return -1;
    if (bValid) return 1;
    return 0;
  };

  missingPlayers.sort((a, b) => {
    const byReminder = timestampDesc(a.last_reminded_at_utc, b.last_reminded_at_utc);
    if (byReminder !== 0) return byReminder;
    return roundTipStatusPlayerComparator(a, b);
  });

  tippedPlayers.sort((a, b) => {
    const bySubmitted = timestampDesc(a.latest_submitted_at_utc, b.latest_submitted_at_utc);
    if (bySubmitted !== 0) return bySubmitted;
    return roundTipStatusPlayerComparator(a, b);
  });

  return {
    missingPlayers,
    tippedPlayers,
    tippedCount: tippedPlayers.length,
    missingCount: missingPlayers.length,
  };
}
