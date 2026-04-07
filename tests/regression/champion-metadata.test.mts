import assert from "node:assert/strict";
import test from "node:test";
import {
  championSeasonLabels,
  editableChampionSeasons,
  normalizeChampionSeasonsByUserId,
  normalizeSeasonChampionSelections,
  sameSeasonChampionSelections,
} from "../../lib/champion-metadata.ts";

test("normalizeSeasonChampionSelections keeps valid unique seasons in order", () => {
  const rows = normalizeSeasonChampionSelections([
    { season: 2026, user_id: "user-b" },
    { season: 2025, user_id: "user-a" },
    { season: 2026, user_id: "user-c" },
    { season: "oops", user_id: "ignored" },
  ]);

  assert.deepEqual(rows, [
    { season: 2025, user_id: "user-a" },
    { season: 2026, user_id: "user-c" },
  ]);
});

test("editableChampionSeasons includes current, previous, and saved seasons", () => {
  assert.deepEqual(
    editableChampionSeasons(2026, [
      { season: 2024, user_id: "user-a" },
      { season: 2026, user_id: "user-b" },
    ]),
    [2024, 2025, 2026]
  );
});

test("normalizeChampionSeasonsByUserId sorts and de-dupes seasons", () => {
  assert.deepEqual(
    normalizeChampionSeasonsByUserId({
      "user-a": [2026, 2025, 2026],
      "user-b": ["bad", 2024],
    }),
    {
      "user-a": [2025, 2026],
      "user-b": [2024],
    }
  );
});

test("championSeasonLabels formats each season label", () => {
  assert.deepEqual(championSeasonLabels([2026, 2025]), [
    "2025 champion",
    "2026 champion",
  ]);
});

test("sameSeasonChampionSelections matches identical normalized lists", () => {
  const left = normalizeSeasonChampionSelections([
    { season: 2025, user_id: "user-a" },
    { season: 2026, user_id: null },
  ]);
  const right = normalizeSeasonChampionSelections([
    { season: 2025, user_id: "user-a" },
    { season: 2026, user_id: null },
  ]);

  assert.equal(sameSeasonChampionSelections(left, right), true);
});
