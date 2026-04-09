import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionOnboardingStage,
  deriveOnboardingStage,
  inferInitialOnboardingStageFromInterestStatus,
  nextSuggestedOnboardingStage,
  normalizeOnboardingPipelineStage,
  summarizeOnboardingStages,
} from "../../lib/onboarding-workflow.ts";

test("onboarding workflow infers invited and archived from legacy interest statuses", () => {
  assert.equal(inferInitialOnboardingStageFromInterestStatus("notified"), "invited");
  assert.equal(inferInitialOnboardingStageFromInterestStatus("unsubscribed"), "archived");
  assert.equal(inferInitialOnboardingStageFromInterestStatus("pending"), "new");
});

test("onboarding workflow derives payment stages from linked membership payment status", () => {
  assert.equal(
    deriveOnboardingStage({
      pipelineStage: "invited",
      linkedUserId: "user-1",
      membershipPaymentStatus: "pending",
    }),
    "payment_pending"
  );

  assert.equal(
    deriveOnboardingStage({
      pipelineStage: "payment_pending",
      linkedUserId: "user-1",
      membershipPaymentStatus: "paid",
    }),
    "active"
  );

  assert.equal(
    deriveOnboardingStage({
      pipelineStage: "invited",
      linkedUserId: "user-1",
      membershipPaymentStatus: null,
    }),
    "joined"
  );
});

test("onboarding workflow falls back to normalized pipeline stage when no member is linked", () => {
  assert.equal(
    deriveOnboardingStage({
      pipelineStage: "contacted",
      interestStatus: "pending",
    }),
    "contacted"
  );

  assert.equal(normalizeOnboardingPipelineStage("weird"), "new");
});

test("onboarding workflow only allows the intended stage transitions", () => {
  assert.equal(
    canTransitionOnboardingStage({ from: "new", to: "reviewed" }),
    true
  );
  assert.equal(
    canTransitionOnboardingStage({ from: "reviewed", to: "invited" }),
    false
  );
  assert.equal(
    canTransitionOnboardingStage({ from: "contacted", to: "archived" }),
    true
  );
  assert.equal(
    canTransitionOnboardingStage({ from: "active", to: "archived" }),
    false
  );
  assert.equal(
    canTransitionOnboardingStage({ from: "archived", to: "reviewed" }),
    true
  );
});

test("onboarding workflow suggests the next operational stage in order", () => {
  assert.equal(nextSuggestedOnboardingStage("new"), "reviewed");
  assert.equal(nextSuggestedOnboardingStage("invited"), "joined");
  assert.equal(nextSuggestedOnboardingStage("payment_pending"), "active");
  assert.equal(nextSuggestedOnboardingStage("active"), null);
});

test("onboarding workflow summarizes rows by derived stage", () => {
  const counts = summarizeOnboardingStages([
    { interestStatus: "pending" },
    { interestStatus: "notified" },
    { interestStatus: "unsubscribed" },
    { pipelineStage: "reviewed" },
    {
      pipelineStage: "invited",
      linkedUserId: "user-1",
      membershipPaymentStatus: "pending",
    },
    {
      pipelineStage: "payment_pending",
      linkedUserId: "user-2",
      membershipPaymentStatus: "waived",
    },
  ]);

  assert.deepEqual(counts, {
    new: 1,
    reviewed: 1,
    contacted: 0,
    invited: 1,
    joined: 0,
    payment_pending: 1,
    active: 1,
    archived: 1,
  });
});
