import assert from "node:assert/strict";
import test from "node:test";
import { isPostLockDataVisible } from "../../lib/post-lock-visibility.ts";

test("post-lock data stays hidden before the round lock time", () => {
  const lockTimeUtc = "2026-03-12T08:30:00.000Z";
  const nowMs = Date.UTC(2026, 2, 12, 8, 29, 59);

  assert.equal(isPostLockDataVisible(lockTimeUtc, nowMs), false);
});

test("post-lock data becomes visible exactly at the round lock boundary", () => {
  const lockTimeUtc = "2026-03-12T08:30:00.000Z";
  const nowMs = Date.UTC(2026, 2, 12, 8, 30, 0);

  assert.equal(isPostLockDataVisible(lockTimeUtc, nowMs), true);
});

test("post-lock data stays hidden when the lock time is missing or invalid", () => {
  const nowMs = Date.UTC(2026, 2, 12, 8, 30, 0);

  assert.equal(isPostLockDataVisible(null, nowMs), false);
  assert.equal(isPostLockDataVisible("not-a-date", nowMs), false);
});
