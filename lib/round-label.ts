const FINALS_LABELS: Record<number, string> = {
  25: "Wildcard Weekend",
  26: "Qualifying & Elimination Finals",
  27: "Semi-Finals",
  28: "Preliminary Finals",
  29: "Grand Final",
};

export function getRoundDisplayName(roundNumber: number): string {
  const n = Number(roundNumber);
  if (!Number.isFinite(n)) return "Round -";
  return FINALS_LABELS[n] ?? `Round ${n}`;
}
