import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRoundPageOddsMap,
  computeRoundPagePaymentLock,
  pickRoundCandidate,
} from "../../lib/round-page-rules.ts";

test("round page candidate selection prefers owner/admin/member role priority", () => {
  const picked = pickRoundCandidate(
    [
      {
        id: "round-member",
        competition_id: "comp-member",
        season: 2026,
        round_number: 5,
        lock_time_utc: "2026-04-10T09:30:00Z",
        odds_snapshot_for_time_utc: null,
      },
      {
        id: "round-owner",
        competition_id: "comp-owner",
        season: 2026,
        round_number: 5,
        lock_time_utc: "2026-04-10T09:30:00Z",
        odds_snapshot_for_time_utc: null,
      },
    ],
    {
      "comp-member": { competition_id: "comp-member", role: "member" },
      "comp-owner": { competition_id: "comp-owner", role: "owner" },
    }
  );

  assert.equal(picked?.competition_id, "comp-owner");
});

test("round page payment lock keeps owner/admin bypass and blocks pending members only", () => {
  assert.equal(
    computeRoundPagePaymentLock({
      memberRole: "member",
      memberPaymentStatus: "pending",
      enforceLock: true,
    }),
    true
  );

  assert.equal(
    computeRoundPagePaymentLock({
      memberRole: "admin",
      memberPaymentStatus: "pending",
      enforceLock: true,
    }),
    false
  );

  assert.equal(
    computeRoundPagePaymentLock({
      memberRole: "member",
      memberPaymentStatus: "paid",
      enforceLock: true,
    }),
    false
  );
});

test("round page odds map keeps the first row per match so later rows do not override it", () => {
  const map = buildRoundPageOddsMap([
    {
      match_id: "match-1",
      home_team: "Carlton",
      away_team: "Richmond",
      home_odds: 1.82,
      away_odds: 2.01,
      captured_at_utc: "2026-04-01T10:00:00Z",
      snapshot_for_time_utc: "2026-04-01T09:30:00Z",
    },
    {
      match_id: "match-1",
      home_team: "Carlton",
      away_team: "Richmond",
      home_odds: 1.76,
      away_odds: 2.08,
      captured_at_utc: "2026-04-01T09:55:00Z",
      snapshot_for_time_utc: "2026-04-01T09:30:00Z",
    },
  ]);

  assert.equal(map["match-1"]?.home_odds, 1.82);
  assert.equal(map["match-1"]?.away_odds, 2.01);
});
