import assert from "node:assert/strict";
import test from "node:test";
import { generateJoinCode } from "../../lib/join-code.ts";

test("generateJoinCode returns an uppercase invite code", () => {
  const code = generateJoinCode();

  assert.equal(code.length, 10);
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
});
