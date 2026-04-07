import test from "node:test";
import assert from "node:assert/strict";
import {
  describeChampionSeasonAuditChanges,
  describeMemberAuditChanges,
} from "../../lib/admin-audit.ts";

test("member audit summary reports changed fields only", () => {
  const changes = describeMemberAuditChanges({
    before: {
      display_name: "Dave",
      role: "member",
      payment_status: "pending",
      is_test_account: false,
    },
    after: {
      display_name: "Dave Bennett",
      role: "admin",
      payment_status: "paid",
      is_test_account: false,
    },
  });

  assert.deepEqual(changes, [
    "display name Dave -> Dave Bennett",
    "role member -> admin",
    "payment pending -> paid",
  ]);
});

test("champion season audit summary identifies set, cleared, and changed seasons", () => {
  const changes = describeChampionSeasonAuditChanges({
    before: [
      { season: 2024, user_id: "u1" },
      { season: 2025, user_id: "u2" },
    ],
    after: [
      { season: 2024, user_id: "u3" },
      { season: 2026, user_id: "u4" },
    ],
  });

  assert.deepEqual(changes, ["2024 changed", "2025 cleared", "2026 set"]);
});
