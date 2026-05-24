export type TeamNameDisplayContext = {
  season?: number | null;
  roundNumber?: number | null;
  referenceTimeUtc?: string | null;
  nowMs?: number;
};

type TeamRenameWindow = {
  season: number;
  roundNumbers: number[];
  startsAtUtc: string;
  endsAtUtcExclusive: string;
};

type TeamRenameDefinition = {
  traditional: string;
  renamed: string;
  aliases: string[];
};

const SIR_DOUG_NICHOLLS_WINDOWS: TeamRenameWindow[] = [
  {
    season: 2026,
    roundNumbers: [10, 11],
    startsAtUtc: "2026-05-13T14:00:00.000Z",
    endsAtUtcExclusive: "2026-05-24T14:00:00.000Z",
  },
];

const SIR_DOUG_NICHOLLS_RENAMES: TeamRenameDefinition[] = [
  {
    traditional: "Adelaide",
    renamed: "Kuwarna",
    aliases: ["adelaide", "adelaide crows", "kuwarna"],
  },
  {
    traditional: "Fremantle",
    renamed: "Walyalup",
    aliases: ["fremantle", "fremantle dockers", "walyalup"],
  },
  {
    traditional: "Melbourne",
    renamed: "Narrm",
    aliases: ["melbourne", "melbourne demons", "narrm", "naarm"],
  },
  {
    traditional: "Port Adelaide",
    renamed: "Yartapuulti",
    aliases: ["port adelaide", "port adelaide power", "yartapuulti"],
  },
  {
    traditional: "St Kilda",
    renamed: "Euro-Yroke",
    aliases: ["st kilda", "st kilda saints", "euro-yroke"],
  },
  {
    traditional: "West Coast",
    renamed: "Waalitj Marawar",
    aliases: ["west coast", "west coast eagles", "waalitj marawar"],
  },
];

const RENAMED_BY_TRADITIONAL = new Map<string, string>();
const TRADITIONAL_BY_ALIAS = new Map<string, string>();

SIR_DOUG_NICHOLLS_RENAMES.forEach((entry) => {
  RENAMED_BY_TRADITIONAL.set(entry.traditional, entry.renamed);
  entry.aliases.forEach((alias) => {
    TRADITIONAL_BY_ALIAS.set(normalizeTeamKey(alias), entry.traditional);
  });
});

function normalizeTeamKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toRoundNumber(value: number | string | null | undefined) {
  const roundNumber = Number(value);
  return Number.isFinite(roundNumber) ? roundNumber : null;
}

function toMs(isoUtc: string) {
  const ms = new Date(isoUtc).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function resolveReferenceMs(context?: TeamNameDisplayContext) {
  if (typeof context?.nowMs === "number" && Number.isFinite(context.nowMs)) {
    return context.nowMs;
  }
  if (context?.referenceTimeUtc) {
    const ms = toMs(context.referenceTimeUtc);
    if (ms !== null) return ms;
  }
  return Date.now();
}

export function isSirDougNichollsTeamRenameActive(context?: TeamNameDisplayContext) {
  const season = Number(context?.season ?? NaN);
  if (!Number.isFinite(season)) return false;

  const roundNumber = toRoundNumber(context?.roundNumber);
  const referenceMs = resolveReferenceMs(context);

  return SIR_DOUG_NICHOLLS_WINDOWS.some((windowRule) => {
    if (windowRule.season !== season) return false;

    if (roundNumber !== null && windowRule.roundNumbers.includes(roundNumber)) {
      return true;
    }

    const startMs = toMs(windowRule.startsAtUtc);
    const endMs = toMs(windowRule.endsAtUtcExclusive);
    if (startMs === null || endMs === null) return false;
    return referenceMs >= startMs && referenceMs < endMs;
  });
}

export function formatAflTeamNameForDisplay(
  rawTeamName: string | null | undefined,
  context?: TeamNameDisplayContext
) {
  const teamName = String(rawTeamName ?? "").trim();
  if (!teamName) return "";

  if (!isSirDougNichollsTeamRenameActive(context)) {
    return teamName;
  }

  const normalized = normalizeTeamKey(teamName);
  const traditional = TRADITIONAL_BY_ALIAS.get(normalized);
  if (!traditional) return teamName;

  const renamed = RENAMED_BY_TRADITIONAL.get(traditional);
  if (!renamed) return teamName;

  return `${renamed} (${traditional})`;
}

export function formatAflMatchupForDisplay(
  homeTeam: string | null | undefined,
  awayTeam: string | null | undefined,
  context?: TeamNameDisplayContext
) {
  const home = formatAflTeamNameForDisplay(homeTeam, context);
  const away = formatAflTeamNameForDisplay(awayTeam, context);
  if (!home && !away) return "";
  if (!home) return away;
  if (!away) return home;
  return `${home} vs ${away}`;
}
