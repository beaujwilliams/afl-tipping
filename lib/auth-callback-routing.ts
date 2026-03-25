export type AuthOtpType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email";

export function getSafeNextPath(raw: string | null) {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  return raw;
}

export function resolvePostAuthRedirectPath({
  flow,
  type,
  otpType,
  nextPath,
}: {
  flow: "code" | "otp";
  type: string | null;
  otpType?: AuthOtpType | null;
  nextPath: string | null;
}) {
  const isRecovery = type === "recovery" || otpType === "recovery";
  const isCodeRecoveryFallback = flow === "code" && nextPath === "/reset-password";

  if (isRecovery || isCodeRecoveryFallback) {
    return "/reset-password";
  }

  return nextPath ?? "/setup";
}
