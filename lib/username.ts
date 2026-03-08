export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const USERNAME_PATTERN = /^[a-z0-9_]+$/;

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function normalizeUsername(input: string | null | undefined) {
  return String(input ?? "")
    .trim()
    .toLowerCase();
}

export function validateUsername(input: string | null | undefined): UsernameValidation {
  const value = normalizeUsername(input);

  if (!value) {
    return { ok: false, error: "Username is required." };
  }

  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) {
    return {
      ok: false,
      error: `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters.`,
    };
  }

  if (!USERNAME_PATTERN.test(value)) {
    return {
      ok: false,
      error: "Username can only use lowercase letters, numbers, and underscores.",
    };
  }

  return { ok: true, value };
}

export function isDuplicateUsernameError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("duplicate key value") ||
    m.includes("ux_profiles_username_lower") ||
    (m.includes("username") && m.includes("unique"))
  );
}

