export type SamplePageKey = "overview" | "home" | "leaderboard" | "round";

export const sampleSuitePages: Array<{
  key: SamplePageKey;
  href: string;
  label: string;
}> = [
  { key: "overview", href: "/next-season/samples", label: "Overview" },
  { key: "home", href: "/next-season/samples/home", label: "Home" },
  { key: "leaderboard", href: "/next-season/samples/leaderboard", label: "Leaderboard" },
  { key: "round", href: "/next-season/samples/round", label: "Round Tipping" },
];

export const homeHeroStats = [
  { label: "Round 19 lock", value: "5h 42m", detail: "Friday 7:50pm Melbourne time" },
  { label: "Tips lodged", value: "63 / 68", detail: "93% comp completion so far" },
  { label: "Leaders split", value: "Yes", detail: "Top two have gone opposite ways" },
  { label: "Unread buzz", value: "14", detail: "Chat mentions and commissioner notes" },
];

export const fixtureRadarCards = [
  {
    slot: "1. Most diverse tips",
    teams: "Dockers vs Suns",
    time: "Fri 7:50pm",
    story: "The crowd is split almost dead even, making this the swing game of the round.",
    leftLabel: "Dockers 51%",
    rightLabel: "Suns 49%",
    leftPct: 51,
    note: "83 tips logged. One result could flip half the ladder.",
  },
  {
    slot: "2. Top 8 matchup",
    teams: "Bulldogs vs Giants",
    time: "Sat 4:35pm",
    story: "A clean top-eight pressure game with finals implications and strong leaderboard relevance.",
    leftLabel: "Dogs 58%",
    rightLabel: "Giants 42%",
    leftPct: 58,
    note: "Both clubs sit inside the current eight, so this gets automatic radar priority.",
  },
  {
    slot: "3. Leaders disagree",
    teams: "Blues vs Lions",
    time: "Sat 7:25pm",
    story: "Amy and Jordan have tipped opposite sides, so the homepage promotes their split as a hero talking point.",
    leftLabel: "Amy: Blues",
    rightLabel: "Jordan: Lions",
    leftPct: 50,
    note: "Only show this slot when rank one and rank two are on different picks.",
  },
];

export const homeSideNotes = [
  {
    title: "Tonight's brief",
    body: "Put the lock timer, fixture radar, and one clean action row ahead of everything else. The home page should feel hosted, not just arranged.",
  },
  {
    title: "Commissioner pulse",
    body: "Spotlight one update card for rules, payments, or round changes so operational messages feel official instead of buried.",
  },
  {
    title: "Chat momentum",
    body: "Carry over the control-room urgency with one compact activity strip rather than a full chat dump.",
  },
];

export const leaderboardRows = [
  { rank: 1, name: "Amy L.", total: "124.50", movement: "+2", streak: "5W", gap: "Leader", accuracy: "71.4%" },
  { rank: 2, name: "Jordan K.", total: "121.00", movement: "-", streak: "4W", gap: "3.50 back", accuracy: "69.8%" },
  { rank: 3, name: "Beau W.", total: "119.50", movement: "+1", streak: "3W", gap: "5.00 back", accuracy: "68.2%" },
  { rank: 4, name: "Priya M.", total: "118.00", movement: "-1", streak: "2W", gap: "6.50 back", accuracy: "67.1%" },
  { rank: 5, name: "Marcus T.", total: "117.25", movement: "+4", streak: "4W", gap: "7.25 back", accuracy: "66.9%" },
  { rank: 6, name: "Nina R.", total: "116.75", movement: "-", streak: "1W", gap: "7.75 back", accuracy: "66.3%" },
  { rank: 7, name: "Lewis H.", total: "115.80", movement: "-2", streak: "1L", gap: "8.70 back", accuracy: "65.0%" },
  { rank: 8, name: "Jade P.", total: "115.25", movement: "+3", streak: "2W", gap: "9.25 back", accuracy: "64.8%" },
];

export const leaderboardStoryCards = [
  {
    title: "Leader race",
    value: "3.50 pts",
    body: "Only one upset result separates first from second, so the hero focuses on pressure rather than raw totals.",
  },
  {
    title: "Cut line",
    value: "6th vs 7th",
    body: "Give the finals edge the same editorial weight as the top of the ladder so mid-table members stay engaged.",
  },
  {
    title: "Biggest mover",
    value: "Marcus +4",
    body: "Movement stories are the quickest way to make the leaderboard feel alive week to week.",
  },
];

export const leaderboardInsights = [
  "Open with the race, not the table. The first screen should tell people what changed this week.",
  "Keep the broadcast flavor in the header, then let the ladder rows become calmer and easier to scan.",
  "Use one side rail for champion notes, group side-stories, or finals pressure instead of scattering badges everywhere.",
];

export const roundSummaryStats = [
  { label: "Tips lodged", value: "6 / 9", detail: "3 still to lock" },
  { label: "Potential score", value: "11.45", detail: "Based on current odds snapshot" },
  { label: "Underdog picks", value: "2", detail: "Both inside the current top eight games" },
  { label: "Odds loaded", value: "9 / 9", detail: "Snapshot taken 36 hours pre-lock" },
];

export const roundMatches = [
  {
    time: "Fri 7:50pm",
    venue: "Marvel Stadium",
    teams: "Dockers vs Suns",
    tipStory: "Most split crowd game",
    splitLeft: "Dockers 51%",
    splitRight: "Suns 49%",
    splitPct: 51,
    homeOdds: "1.88",
    awayOdds: "1.96",
    pickedTeam: "Dockers",
    note: "This card should surface first because it is both close in tips and close in odds.",
  },
  {
    time: "Sat 1:45pm",
    venue: "GMHBA Stadium",
    teams: "Cats vs Swans",
    tipStory: "Safe crowd lean",
    splitLeft: "Cats 68%",
    splitRight: "Swans 32%",
    splitPct: 68,
    homeOdds: "1.55",
    awayOdds: "2.48",
    pickedTeam: "Cats",
    note: "Use a softer card state when the market and crowd both agree.",
  },
  {
    time: "Sat 4:35pm",
    venue: "Mars Stadium",
    teams: "Bulldogs vs Giants",
    tipStory: "Top 8 pressure game",
    splitLeft: "Dogs 58%",
    splitRight: "Giants 42%",
    splitPct: 58,
    homeOdds: "1.74",
    awayOdds: "2.16",
    pickedTeam: "Giants",
    note: "This is where an underdog badge can feel earned instead of decorative.",
  },
  {
    time: "Sat 7:25pm",
    venue: "MCG",
    teams: "Blues vs Lions",
    tipStory: "Leaders disagree",
    splitLeft: "Blues 47%",
    splitRight: "Lions 53%",
    splitPct: 47,
    homeOdds: "2.08",
    awayOdds: "1.72",
    pickedTeam: "Blues",
    note: "The moment first and second split, this match should get an editorial marker.",
  },
  {
    time: "Sun 3:20pm",
    venue: "Gabba",
    teams: "Lions vs Pies",
    tipStory: "Prime-time closer",
    splitLeft: "Lions 61%",
    splitRight: "Pies 39%",
    splitPct: 61,
    homeOdds: "1.67",
    awayOdds: "2.22",
    pickedTeam: "Lions",
    note: "Late-round matches deserve a slightly different emphasis so the list does not feel flat.",
  },
];

export const roundRadarNotes = [
  {
    title: "Round radar",
    body: "Keep one right rail that explains the strategy story of the round: crowd fades, leader disagreements, and underdog count.",
  },
  {
    title: "Odds confidence",
    body: "Show the snapshot timing and market confidence next to the tipping interface so it feels rigorous and intentional.",
  },
  {
    title: "Action flow",
    body: "The primary CTA should stay close to progress, not buried below every game. Make saving feel immediate and official.",
  },
];
