export function toUtcMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function isSameInstant(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const aMs = toUtcMs(a);
  const bMs = toUtcMs(b);
  return aMs !== null && bMs !== null && aMs === bMs;
}
