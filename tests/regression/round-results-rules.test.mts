import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRoundResultsSnapshot,
  pickFirstOddsByMatch,
  roundResultsPlayerComparator,
} from "../../lib/round-results-rules.ts";

function assertClose(actual: number | undefined, expected: number, epsilon = 1e-9) {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

const MATCHES = [
  {
    id: "m1",
    home_team: "Sydney",
    away_team: "Carlton",
    winner_team: "Sydney",
    commence_time_utc: "2026-03-12T08:30:00.000Z",
    venue: "SCG",
    status: "finished",
  },
  {
    id: "m2",
    home_team: "Geelong",
    away_team: "Brisbane",
    winner_team: null,
    commence_time_utc: "2026-03-13T08:40:00.000Z",
    venue: "GMHBA Stadium",
    status: "scheduled",
  },
  {
    id: "m3",
    home_team: "Bulldogs",
    away_team: "Adelaide",
    winner_team: "Adelaide",
    commence_time_utc: "2026-03-14T03:15:00.000Z",
    venue: "Marvel Stadium",
    status: "finished",
  },
] as const;

const ELIGIBLE_PLAYERS = [
  { user_id: "u-a", display_name: "Alice", payment_status: "paid" },
  { user_id: "u-b", display_name: "Bob", payment_status: "pending" },
  { user_id: "u-c", display_name: "Charlie", payment_status: "waived" },
  { user_id: "u-d", display_name: "Dana", payment_status: "paid" },
] as const;

const TIPS = [
  { user_id: "u-a", match_id: "m1", picked_team: "Sydney" },
  { user_id: "u-a", match_id: "m2", picked_team: "Brisbane" },
  { user_id: "u-a", match_id: "m3", picked_team: "Adelaide" },
  { user_id: "u-b", match_id: "m1", picked_team: "Carlton" },
  { user_id: "u-b", match_id: "m2", picked_team: "Geelong" },
  { user_id: "u-b", match_id: "m3", picked_team: "Adelaide" },
  { user_id: "u-c", match_id: "m1", picked_team: "Sydney" },
  { user_id: "u-c", match_id: "m3", picked_team: "Bulldogs" },
  { user_id: "u-x", match_id: "m1", picked_team: "Sydney" },
] as const;

const ODDS_BY_MATCH = {
  m1: { home_odds: 1.5, away_odds: 2.6 },
  m2: { home_odds: 1.8, away_odds: 2.1 },
  m3: { home_odds: 1.4, away_odds: 2.9 },
} as const;

test("round results comparator keeps score -> correct tips -> name ordering", () => {
  const rows = [
    { display_name: "Zulu", round_score: 10, correct_tips: 4 },
    { display_name: "Alpha", round_score: 10, correct_tips: 4 },
    { display_name: "Bravo", round_score: 10, correct_tips: 5 },
    { display_name: "Charlie", round_score: 9.5, correct_tips: 6 },
  ];

  const sorted = [...rows].sort(roundResultsPlayerComparator);
  assert.deepEqual(
    sorted.map((row) => row.display_name),
    ["Bravo", "Alpha", "Zulu", "Charlie"]
  );
});

test("round results snapshot uses only completed matches for accuracy", () => {
  const snapshot = buildRoundResultsSnapshot({
    matches: [...MATCHES],
    tips: [...TIPS],
    eligiblePlayers: [...ELIGIBLE_PLAYERS],
    oddsByMatchId: { ...ODDS_BY_MATCH },
  });

  const alice = snapshot.players.find((player) => player.user_id === "u-a");
  const bob = snapshot.players.find((player) => player.user_id === "u-b");

  assert.equal(alice?.accuracy_pct, 100);
  assert.equal(bob?.accuracy_pct, 50);
});

test("round results snapshot sums potential score from every tipped match", () => {
  const snapshot = buildRoundResultsSnapshot({
    matches: [...MATCHES],
    tips: [...TIPS],
    eligiblePlayers: [...ELIGIBLE_PLAYERS],
    oddsByMatchId: { ...ODDS_BY_MATCH },
  });

  const alice = snapshot.players.find((player) => player.user_id === "u-a");
  const bob = snapshot.players.find((player) => player.user_id === "u-b");

  assertClose(alice?.potential_score, 6.5);
  assertClose(bob?.potential_score, 7.3);
});

test("round results snapshot calculates difference score as potential minus actual", () => {
  const snapshot = buildRoundResultsSnapshot({
    matches: [...MATCHES],
    tips: [...TIPS],
    eligiblePlayers: [...ELIGIBLE_PLAYERS],
    oddsByMatchId: { ...ODDS_BY_MATCH },
  });

  const alice = snapshot.players.find((player) => player.user_id === "u-a");
  const bob = snapshot.players.find((player) => player.user_id === "u-b");

  assertClose(alice?.difference_score, 2.1);
  assertClose(bob?.difference_score, 4.4);
});

test("round results snapshot aggregates match tipping counts and percentages", () => {
  const snapshot = buildRoundResultsSnapshot({
    matches: [...MATCHES],
    tips: [...TIPS],
    eligiblePlayers: [...ELIGIBLE_PLAYERS],
    oddsByMatchId: { ...ODDS_BY_MATCH },
  });

  const firstMatch = snapshot.matches.find((match) => match.id === "m1");
  const secondMatch = snapshot.matches.find((match) => match.id === "m2");

  assert.deepEqual(firstMatch?.tipping, {
    home_team: "Sydney",
    away_team: "Carlton",
    home_count: 2,
    away_count: 1,
    home_pct: 67,
    away_pct: 33,
  });
  assert.deepEqual(secondMatch?.tipping, {
    home_team: "Geelong",
    away_team: "Brisbane",
    home_count: 1,
    away_count: 1,
    home_pct: 50,
    away_pct: 50,
  });
});

test("round results snapshot excludes users outside the eligible player set", () => {
  const snapshot = buildRoundResultsSnapshot({
    matches: [...MATCHES],
    tips: [...TIPS],
    eligiblePlayers: [...ELIGIBLE_PLAYERS],
    oddsByMatchId: { ...ODDS_BY_MATCH },
  });

  assert.equal(snapshot.players.some((player) => player.user_id === "u-x"), false);
});

test("round results snapshot omits eligible players with no submitted tips", () => {
  const snapshot = buildRoundResultsSnapshot({
    matches: [...MATCHES],
    tips: [...TIPS],
    eligiblePlayers: [...ELIGIBLE_PLAYERS],
    oddsByMatchId: { ...ODDS_BY_MATCH },
  });

  assert.equal(snapshot.players.some((player) => player.user_id === "u-d"), false);
});

test("round results snapshot keeps average correct odds based on winning picks only", () => {
  const snapshot = buildRoundResultsSnapshot({
    matches: [...MATCHES],
    tips: [...TIPS],
    eligiblePlayers: [...ELIGIBLE_PLAYERS],
    oddsByMatchId: { ...ODDS_BY_MATCH },
  });

  const alice = snapshot.players.find((player) => player.user_id === "u-a");
  const charlie = snapshot.players.find((player) => player.user_id === "u-c");

  assert.equal(alice?.avg_correct_odds, 2.2);
  assert.equal(charlie?.avg_correct_odds, 1.5);
});

test("round results snapshot keeps accuracy at 0 when no matches are finished", () => {
  const snapshot = buildRoundResultsSnapshot({
    matches: MATCHES.map((match) => ({ ...match, winner_team: null })),
    tips: [...TIPS],
    eligiblePlayers: [...ELIGIBLE_PLAYERS],
    oddsByMatchId: { ...ODDS_BY_MATCH },
  });

  snapshot.players.forEach((player) => {
    assert.equal(player.accuracy_pct, 0);
    assert.equal(player.round_score, 0);
  });
});

test("odds selection keeps the first row per match so later rows cannot override it", () => {
  const oddsByMatchId = pickFirstOddsByMatch([
    { match_id: "m1", home_odds: 1.82, away_odds: 2.04 },
    { match_id: "m1", home_odds: 1.76, away_odds: 2.11 },
    { match_id: "m2", home_odds: 1.91, away_odds: 1.91 },
  ]);

  assert.deepEqual(oddsByMatchId, {
    m1: { home_odds: 1.82, away_odds: 2.04 },
    m2: { home_odds: 1.91, away_odds: 1.91 },
  });
});
