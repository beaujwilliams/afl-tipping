export const MAX_QUICK_REMINDER_NAMES = 100;
export const MAX_QUICK_REMINDER_NAME_LENGTH = 120;

function splitReminderInput(raw: unknown) {
  if (typeof raw === "string") return raw.split(/\r?\n/);
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((value) =>
    typeof value === "string" ? value.split(/\r?\n/) : []
  );
}

export function normalizeReminderName(raw: string) {
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_QUICK_REMINDER_NAME_LENGTH);
}

export function reminderNameKey(raw: string | null | undefined) {
  return normalizeReminderName(String(raw ?? "")).toLocaleLowerCase("en-AU");
}

export function parseQuickReminderNames(raw: unknown) {
  const names: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let overflowCount = 0;

  splitReminderInput(raw).forEach((value) => {
    const name = normalizeReminderName(value);
    if (!name) return;

    const key = reminderNameKey(name);
    if (seen.has(key)) {
      duplicateCount += 1;
      return;
    }

    seen.add(key);
    if (names.length >= MAX_QUICK_REMINDER_NAMES) {
      overflowCount += 1;
      return;
    }
    names.push(name);
  });

  return { names, duplicateCount, overflowCount };
}
