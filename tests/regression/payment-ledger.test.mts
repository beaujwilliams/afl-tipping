import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLinkedOnboardingPreview,
  findAutoLinkedOnboardingCandidate,
  getSeasonBuyInCents,
  normalizePaymentMethod,
  normalizePaymentReconciliationStatus,
  suggestPaymentMemberMatches,
} from "../../lib/payment-ledger.ts";

test("payment ledger normalizes method and reconciliation status", () => {
  assert.equal(normalizePaymentMethod("PayID"), "payid");
  assert.equal(normalizePaymentMethod("weird"), "bank_transfer");
  assert.equal(normalizePaymentReconciliationStatus("matched"), "matched");
  assert.equal(normalizePaymentReconciliationStatus("something-else"), "unmatched");
});

test("payment ledger suggests an exact email match ahead of name-only matches", () => {
  const suggestions = suggestPaymentMemberMatches({
    payment: {
      season: 2026,
      amount_cents: 3000,
      payer_email: "dave@example.com",
      payer_name: "David Bennett",
      reference_text: "Season payment",
    },
    members: [
      {
        user_id: "user-1",
        email: "john@example.com",
        display_name: "John Bennett",
        payment_status: "pending",
        role: "member",
      },
      {
        user_id: "user-2",
        email: "dave@example.com",
        display_name: "Dave Bennett",
        payment_status: "pending",
        role: "member",
      },
    ],
  });

  assert.equal(suggestions[0]?.user_id, "user-2");
  assert.ok(suggestions[0]?.reasons.includes("email matches exactly"));
});

test("payment ledger can suggest from reference text and pending status", () => {
  const suggestions = suggestPaymentMemberMatches({
    payment: {
      season: 2026,
      amount_cents: 3000,
      payer_email: null,
      payer_name: null,
      reference_text: "Beau Williams tipping",
    },
    members: [
      {
        user_id: "user-1",
        email: "beau@example.com",
        display_name: "Beau Williams",
        payment_status: "pending",
        role: "member",
      },
      {
        user_id: "user-2",
        email: "other@example.com",
        display_name: "Alex Kingham",
        payment_status: "paid",
        role: "member",
      },
    ],
  });

  assert.equal(suggestions[0]?.user_id, "user-1");
  assert.ok(suggestions[0]?.reasons.some((reason) => reason.includes("display name") || reason.includes("name token")));
  assert.ok(suggestions[0]?.reasons.includes("amount matches the season buy-in"));
});

test("payment ledger prefers a same-user onboarding row before a raw email match", () => {
  const row = findAutoLinkedOnboardingCandidate({
    season: 2027,
    matchedUserId: "user-1",
    matchedMemberEmail: "user@example.com",
    rows: [
      {
        id: "row-1",
        target_season: 2027,
        email: "user@example.com",
        full_name: "User One",
        status: "pending",
        pipeline_stage: "payment_pending",
        linked_user_id: "user-1",
      },
      {
        id: "row-2",
        target_season: 2027,
        email: "user@example.com",
        full_name: "User One",
        status: "pending",
        pipeline_stage: "payment_pending",
        linked_user_id: null,
      },
    ],
  });

  assert.equal(row?.id, "row-1");
});

test("payment ledger can auto-link a same-season onboarding row by exact email", () => {
  const row = findAutoLinkedOnboardingCandidate({
    season: 2027,
    matchedUserId: "user-2",
    matchedMemberEmail: "user@example.com",
    rows: [
      {
        id: "row-1",
        target_season: 2026,
        email: "user@example.com",
        full_name: "Wrong Season",
        status: "pending",
        pipeline_stage: "payment_pending",
        linked_user_id: null,
      },
      {
        id: "row-2",
        target_season: 2027,
        email: "user@example.com",
        full_name: "Right Season",
        status: "pending",
        pipeline_stage: "payment_pending",
        linked_user_id: null,
      },
    ],
  });

  assert.equal(row?.id, "row-2");
  assert.equal(
    buildLinkedOnboardingPreview({
      ...row!,
      linked_user_id: "user-2",
      membership_payment_status: "paid",
    })?.derived_stage,
    "active"
  );
});

test("payment ledger exposes a stable default buy-in amount", () => {
  assert.equal(getSeasonBuyInCents(2026), 3000);
  assert.equal(getSeasonBuyInCents(2032), 3000);
});
