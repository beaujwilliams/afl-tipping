export const AFL_TEAMS = [
  "Adelaide Crows",
  "Brisbane Lions",
  "Carlton Blues",
  "Collingwood Magpies",
  "Essendon Bombers",
  "Fremantle Dockers",
  "Geelong Cats",
  "Gold Coast Suns",
  "GWS Giants",
  "Hawthorn Hawks",
  "Melbourne Demons",
  "North Melbourne Kangaroos",
  "Port Adelaide Power",
  "Richmond Tigers",
  "St Kilda Saints",
  "Sydney Swans",
  "West Coast Eagles",
  "Western Bulldogs",
] as const;

export type AflTeam = (typeof AFL_TEAMS)[number];

export function isValidAflTeam(value: string | null | undefined): value is AflTeam {
  if (!value) return false;
  return (AFL_TEAMS as readonly string[]).includes(value);
}
