const DEFAULT_CURRENT_SEASON = 2026;

function parseSeason(raw: string | undefined) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) {
    return DEFAULT_CURRENT_SEASON;
  }
  return Math.trunc(parsed);
}

function parseBool(raw: string | undefined, fallback: boolean) {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

export const CURRENT_SEASON = parseSeason(process.env.NEXT_PUBLIC_CURRENT_SEASON);
export const NEXT_SEASON = CURRENT_SEASON + 1;

// Keep signup closed by default during an active season.
export const SIGNUPS_OPEN = parseBool(process.env.NEXT_PUBLIC_SIGNUPS_OPEN, false);
