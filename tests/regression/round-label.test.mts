import assert from "node:assert/strict";
import test from "node:test";
import { getRoundDisplayName } from "../../lib/round-label.ts";

test("round labels use regular round names before finals", () => {
  assert.equal(getRoundDisplayName(1), "Round 1");
  assert.equal(getRoundDisplayName(24), "Round 24");
});

test("round labels use the 2026 wildcard finals sequence", () => {
  assert.equal(getRoundDisplayName(25), "Wildcard Weekend");
  assert.equal(getRoundDisplayName(26), "Qualifying & Elimination Finals");
  assert.equal(getRoundDisplayName(27), "Semi-Finals");
  assert.equal(getRoundDisplayName(28), "Preliminary Finals");
  assert.equal(getRoundDisplayName(29), "Grand Final");
});

test("round labels handle invalid input", () => {
  assert.equal(getRoundDisplayName(Number.NaN), "Round -");
});
