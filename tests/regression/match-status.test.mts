import assert from "node:assert/strict";
import test from "node:test";
import {
  isDrawnMatch,
  isFinalMatchStatus,
  isMatchCompleted,
} from "../../lib/match-status.ts";

test("match status treats final draws as completed matches", () => {
  assert.equal(isFinalMatchStatus("final"), true);
  assert.equal(isFinalMatchStatus("finished"), true);
  assert.equal(isFinalMatchStatus("scheduled"), false);

  assert.equal(isMatchCompleted({ status: "final", winner_team: null }), true);
  assert.equal(isDrawnMatch({ status: "final", winner_team: null }), true);
  assert.equal(isDrawnMatch({ status: "final", winner_team: "Hawthorn" }), false);
  assert.equal(isMatchCompleted({ status: "scheduled", winner_team: null }), false);
});
