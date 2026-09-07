import assert from "node:assert/strict";
import test from "node:test";
import {
  getRoundDisplayName,
  getRoundDisplayNameWithNumber,
  getRoundShortDisplayName,
} from "../../lib/round-label.ts";

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

test("compact round labels keep regular rounds short and finals named", () => {
  assert.equal(getRoundShortDisplayName(10), "R10");
  assert.equal(getRoundShortDisplayName(25), "Wildcard Weekend");
  assert.equal(getRoundShortDisplayName(26), "Qualifying & Elimination Finals");
});

test("round labels with number keep finals traceable to stored round ids", () => {
  assert.equal(getRoundDisplayNameWithNumber(10), "Round 10");
  assert.equal(
    getRoundDisplayNameWithNumber(26),
    "Qualifying & Elimination Finals (Round 26)"
  );
  assert.equal(getRoundDisplayNameWithNumber(Number.NaN), "Round -");
});
