import assert from "node:assert/strict";
import test from "node:test";
import {
  getSafeNextPath,
  resolvePostAuthRedirectPath,
} from "../../lib/auth-callback-routing.ts";

test("getSafeNextPath allows site-relative paths only", () => {
  assert.equal(getSafeNextPath("/reset-password"), "/reset-password");
  assert.equal(getSafeNextPath("/comp/NEEDLESSLY"), "/comp/NEEDLESSLY");
  assert.equal(getSafeNextPath("https://example.com/reset"), null);
  assert.equal(getSafeNextPath("//example.com/reset"), null);
  assert.equal(getSafeNextPath("reset-password"), null);
});

test("code callback routes recovery to reset page", () => {
  assert.equal(
    resolvePostAuthRedirectPath({
      flow: "code",
      type: "recovery",
      nextPath: null,
    }),
    "/reset-password"
  );
});

test("code callback treats next=/reset-password as recovery fallback", () => {
  assert.equal(
    resolvePostAuthRedirectPath({
      flow: "code",
      type: null,
      nextPath: "/reset-password",
    }),
    "/reset-password"
  );
});

test("otp callback always routes recovery to reset page", () => {
  assert.equal(
    resolvePostAuthRedirectPath({
      flow: "otp",
      type: "recovery",
      otpType: "recovery",
      nextPath: "/setup",
    }),
    "/reset-password"
  );
});

test("non-recovery callbacks use safe next path or setup fallback", () => {
  assert.equal(
    resolvePostAuthRedirectPath({
      flow: "code",
      type: "signup",
      nextPath: "/comp/NEEDLESSLY",
    }),
    "/comp/NEEDLESSLY"
  );

  assert.equal(
    resolvePostAuthRedirectPath({
      flow: "code",
      type: "signup",
      nextPath: null,
    }),
    "/setup"
  );
});
