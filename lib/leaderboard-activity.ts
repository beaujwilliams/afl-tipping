const MELBOURNE_TIME_ZONE = "Australia/Melbourne";

function getMelbourneParts(atMs: number) {
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: MELBOURNE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const partMap = new Map(
    formatter.formatToParts(new Date(atMs)).map((part) => [part.type, part.value])
  );

  return {
    year: Number(partMap.get("year")),
    month: Number(partMap.get("month")),
    day: Number(partMap.get("day")),
    hour: Number(partMap.get("hour")),
    minute: Number(partMap.get("minute")),
    second: Number(partMap.get("second")),
    weekday: String(partMap.get("weekday") ?? ""),
  };
}

function weekdayOffsetFromMonday(weekday: string) {
  const normalized = weekday.trim().toLowerCase();
  if (normalized.startsWith("mon")) return 0;
  if (normalized.startsWith("tue")) return 1;
  if (normalized.startsWith("wed")) return 2;
  if (normalized.startsWith("thu")) return 3;
  if (normalized.startsWith("fri")) return 4;
  if (normalized.startsWith("sat")) return 5;
  return 6;
}

function localMelbourneDateTimeToUtcMs(params: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}) {
  const hour = params.hour ?? 0;
  const minute = params.minute ?? 0;
  const second = params.second ?? 0;
  const desiredUtcMs = Date.UTC(params.year, params.month - 1, params.day, hour, minute, second);
  let guessUtcMs = desiredUtcMs;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = getMelbourneParts(guessUtcMs);
    const actualAsUtcMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const diffMs = desiredUtcMs - actualAsUtcMs;
    if (diffMs === 0) break;
    guessUtcMs += diffMs;
  }

  return guessUtcMs;
}

export function getCurrentMelbourneMondayCheckpointMs(nowMs = Date.now()) {
  const melbourneNow = getMelbourneParts(nowMs);
  const mondayDateUtc = new Date(
    Date.UTC(melbourneNow.year, melbourneNow.month - 1, melbourneNow.day)
  );
  mondayDateUtc.setUTCDate(
    mondayDateUtc.getUTCDate() - weekdayOffsetFromMonday(melbourneNow.weekday)
  );

  return localMelbourneDateTimeToUtcMs({
    year: mondayDateUtc.getUTCFullYear(),
    month: mondayDateUtc.getUTCMonth() + 1,
    day: mondayDateUtc.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  });
}

export function pickActivityCutoffRoundNumber(params: {
  rounds: Array<{ round_number: number; lock_time_utc: string | null }>;
  roundNumbersWithMatches: Iterable<number>;
  checkTimeMs: number;
}) {
  const roundNumbersWithMatches = new Set<number>(params.roundNumbersWithMatches);
  const roundsWithMatches = params.rounds
    .map((round) => ({
      round_number: Number(round.round_number),
      lock_time_utc: round.lock_time_utc,
    }))
    .filter((round) => roundNumbersWithMatches.has(round.round_number))
    .sort((a, b) => a.round_number - b.round_number);

  if (roundsWithMatches.length === 0) return null;

  const eligibleRounds = roundsWithMatches
    .filter((round) => {
      const lockMs = round.lock_time_utc ? new Date(round.lock_time_utc).getTime() : NaN;
      return Number.isFinite(lockMs) && lockMs < params.checkTimeMs;
    })
    .sort((a, b) => {
      const aLock = a.lock_time_utc
        ? new Date(a.lock_time_utc).getTime()
        : Number.NEGATIVE_INFINITY;
      const bLock = b.lock_time_utc
        ? new Date(b.lock_time_utc).getTime()
        : Number.NEGATIVE_INFINITY;
      if (aLock !== bLock) return bLock - aLock;
      return b.round_number - a.round_number;
    })[0];

  return eligibleRounds?.round_number ?? null;
}

export function countConsecutiveMissedRounds(params: {
  orderedRoundNumbers: number[];
  tippedRoundNumbers: Iterable<number>;
  cutoffRoundNumber: number | null;
}) {
  if (params.cutoffRoundNumber === null) return 0;

  const tippedRoundNumbers = new Set<number>(params.tippedRoundNumbers);
  let missedRounds = 0;

  for (let index = params.orderedRoundNumbers.length - 1; index >= 0; index -= 1) {
    const roundNumber = Number(params.orderedRoundNumbers[index]);
    if (roundNumber > params.cutoffRoundNumber) continue;
    if (tippedRoundNumbers.has(roundNumber)) break;
    missedRounds += 1;
  }

  return missedRounds;
}
