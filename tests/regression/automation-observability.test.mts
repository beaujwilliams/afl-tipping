import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPrelockReminderRun,
  classifySnapshotRun,
  summarizeScoringRun,
} from "../../lib/automation-observability.ts";

test("snapshot classification marks a successful capture correctly", () => {
  const result = classifySnapshotRun(
    {
      ok: true,
      capturedRounds: 1,
      next: { round: 6 },
    },
    200
  );

  assert.equal(result.runStatus, "success");
  assert.match(result.summary, /round 6/i);
});

test("snapshot classification treats no due rounds as skipped", () => {
  const result = classifySnapshotRun(
    {
      ok: true,
      capturedRounds: 0,
      processedDueRounds: 0,
      skipped_reason: "no_due_rounds_pending_capture",
    },
    200
  );

  assert.equal(result.runStatus, "skipped");
});

test("prelock reminder classification marks delivery failures as failed", () => {
  const result = classifyPrelockReminderRun(
    {
      ok: true,
      rounds_targeted: 1,
      totals: {
        sent: 3,
        failed: 2,
        no_email: 1,
      },
      errors: [],
    },
    200
  );

  assert.equal(result.runStatus, "failed");
  assert.match(result.summary, /failed 2/i);
});

test("prelock reminder classification marks idle windows as skipped", () => {
  const result = classifyPrelockReminderRun(
    {
      ok: true,
      rounds_targeted: 0,
      totals: {
        sent: 0,
        simulated: 0,
        failed: 0,
      },
      errors: [],
    },
    200
  );

  assert.equal(result.runStatus, "skipped");
});

test("scoring summary prefers nested error details on failed runs", () => {
  const summary = summarizeScoringRun({
    job_kind: "scoring_15m",
    scope: "active",
    run_status: "failed",
    sync_updated: 0,
    leaderboard_recalc_ran: false,
    leaderboard_recalc_ok: null,
    details: {
      sync_results: {
        json: {
          error: "Squiggle timed out",
        },
      },
    },
  });

  assert.equal(summary, "Squiggle timed out");
});
