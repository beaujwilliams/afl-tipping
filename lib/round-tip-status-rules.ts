export type RoundTipStatusPlayer = {
  user_id: string;
  display_name: string | null;
  payment_status: string | null;
  tips_entered: number;
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
}) {
  const tipsByUser = params.tipCountByUserId ?? new Map<string, number>();
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
    };

    if (hasCompletedTips(userId)) tippedPlayers.push(row);
    else missingPlayers.push(row);
  }

  missingPlayers.sort(roundTipStatusPlayerComparator);
  tippedPlayers.sort(roundTipStatusPlayerComparator);

  return {
    missingPlayers,
    tippedPlayers,
    tippedCount: tippedPlayers.length,
    missingCount: missingPlayers.length,
  };
}
