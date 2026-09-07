export type RankTrendPoint = {
  round_number: number;
  rank: number;
};

export type RankTrendSeries = {
  user_id: string;
  display_name: string;
  points: RankTrendPoint[];
};

export type RankFluctuationSummary = {
  user_id: string;
  display_name: string;
  total_position_changes: number;
  biggest_single_change: number;
  transition_count: number;
  start_rank: number;
  start_round: number;
  finish_rank: number;
  finish_round: number;
};

export function buildRankFluctuationSummary(
  series: RankTrendSeries,
  includedRoundNumbers?: ReadonlySet<number>
): RankFluctuationSummary | null {
  const pointsByRound = new Map<number, RankTrendPoint>();

  for (const point of series.points ?? []) {
    const roundNumber = Number(point.round_number);
    const rank = Number(point.rank);
    if (!Number.isFinite(roundNumber) || !Number.isFinite(rank)) continue;
    if (includedRoundNumbers && !includedRoundNumbers.has(roundNumber)) continue;
    pointsByRound.set(roundNumber, {
      round_number: roundNumber,
      rank,
    });
  }

  const points = Array.from(pointsByRound.values()).sort(
    (a, b) => a.round_number - b.round_number
  );

  if (points.length < 2) return null;

  let totalPositionChanges = 0;
  let biggestSingleChange = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const change = Math.abs(current.rank - previous.rank);
    totalPositionChanges += change;
    biggestSingleChange = Math.max(biggestSingleChange, change);
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return {
    user_id: String(series.user_id),
    display_name: String(series.display_name ?? ""),
    total_position_changes: totalPositionChanges,
    biggest_single_change: biggestSingleChange,
    transition_count: points.length - 1,
    start_rank: firstPoint.rank,
    start_round: firstPoint.round_number,
    finish_rank: lastPoint.rank,
    finish_round: lastPoint.round_number,
  };
}
