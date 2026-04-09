const FINALS_LABELS: Record<number, string> = {
  25: "Finals Week 1",
  26: "Finals Week 2",
  27: "Preliminary Finals",
  28: "Grand Final",
};

export function getRoundDisplayName(roundNumber: number): string {
  const n = Number(roundNumber);
  if (!Number.isFinite(n)) return "Round -";
  return FINALS_LABELS[n] ?? `Round ${n}`;
}
