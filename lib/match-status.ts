export type MatchCompletionInput = {
  status?: string | null;
  winner_team?: string | null;
};

const FINAL_STATUSES = new Set([
  "final",
  "finished",
  "complete",
  "completed",
  "fulltime",
  "full-time",
  "ft",
]);

export function normalizeMatchStatus(status: string | null | undefined) {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

export function isFinalMatchStatus(status: string | null | undefined) {
  return FINAL_STATUSES.has(normalizeMatchStatus(status));
}

export function hasMatchWinner(match: MatchCompletionInput) {
  return String(match.winner_team ?? "").trim().length > 0;
}

export function isMatchCompleted(match: MatchCompletionInput) {
  return hasMatchWinner(match) || isFinalMatchStatus(match.status);
}

export function isDrawnMatch(match: MatchCompletionInput) {
  return isFinalMatchStatus(match.status) && !hasMatchWinner(match);
}
