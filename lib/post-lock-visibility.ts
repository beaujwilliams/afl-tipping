export function isPostLockDataVisible(
  lockTimeUtc: string | null,
  nowMs: number = Date.now()
) {
  if (!lockTimeUtc) return false;
  const lockMs = new Date(lockTimeUtc).getTime();
  if (!Number.isFinite(lockMs)) return false;
  return nowMs >= lockMs;
}
