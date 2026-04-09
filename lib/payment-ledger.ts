export type PaymentMethod = "bank_transfer" | "payid" | "cash" | "other";
export type PaymentReconciliationStatus = "unmatched" | "matched" | "ignored";
export type OnboardingDerivedStage =
  | "new"
  | "reviewed"
  | "contacted"
  | "invited"
  | "joined"
  | "payment_pending"
  | "active"
  | "archived";
export type OnboardingPaymentStatus = "paid" | "pending" | "waived" | null;

export type PaymentMemberCandidate = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  payment_status: OnboardingPaymentStatus;
  role: string | null;
};

export type PaymentLedgerRecordLike = {
  season: number;
  amount_cents: number;
  payer_name?: string | null;
  payer_email?: string | null;
  reference_text?: string | null;
};

export type PaymentMatchSuggestion = PaymentMemberCandidate & {
  score: number;
  reasons: string[];
};

export type PaymentOnboardingCandidate = {
  id: string;
  target_season: number;
  email: string | null;
  full_name: string | null;
  status?: string | null;
  pipeline_stage?: string | null;
  linked_user_id?: string | null;
  membership_payment_status?: string | null;
};

export type PaymentLinkedOnboardingPreview = {
  id: string;
  email: string | null;
  full_name: string | null;
  derived_stage: OnboardingDerivedStage;
};

const BUY_IN_CENTS_BY_SEASON: Record<number, number> = {
  2026: 3000,
  2027: 3000,
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLowerText(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function normalizeEmail(value: string | null | undefined) {
  const text = normalizeLowerText(value);
  return text || null;
}

function tokenize(value: string | null | undefined) {
  return normalizeLowerText(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function normalizeNextSeasonInterestStatus(raw: string | null | undefined) {
  const value = normalizeLowerText(raw);
  if (value === "notified" || value === "unsubscribed") return value;
  return "pending";
}

function normalizeOnboardingPipelineStage(raw: string | null | undefined) {
  const value = normalizeLowerText(raw);
  if (
    value === "new" ||
    value === "reviewed" ||
    value === "contacted" ||
    value === "invited" ||
    value === "joined" ||
    value === "payment_pending" ||
    value === "active" ||
    value === "archived"
  ) {
    return value;
  }
  return "new";
}

function normalizeOnboardingPaymentStatus(raw: string | null | undefined): OnboardingPaymentStatus {
  const value = normalizeLowerText(raw);
  if (value === "paid" || value === "pending" || value === "waived") {
    return value;
  }
  return null;
}

export function normalizePaymentMethod(raw: string | null | undefined): PaymentMethod {
  const value = normalizeLowerText(raw);
  if (value === "payid" || value === "cash" || value === "other") return value;
  return "bank_transfer";
}

export function normalizePaymentReconciliationStatus(
  raw: string | null | undefined
): PaymentReconciliationStatus {
  const value = normalizeLowerText(raw);
  if (value === "matched" || value === "ignored") return value;
  return "unmatched";
}

export function getSeasonBuyInCents(season: number) {
  const normalizedSeason = Number.isFinite(season) ? Math.trunc(season) : 0;
  return BUY_IN_CENTS_BY_SEASON[normalizedSeason] ?? 3000;
}

function deriveOnboardingStage(params: {
  pipelineStage?: string | null;
  interestStatus?: string | null;
  linkedUserId?: string | null;
  membershipPaymentStatus?: string | null;
}): OnboardingDerivedStage {
  const paymentStatus = normalizeOnboardingPaymentStatus(params.membershipPaymentStatus);
  const linkedUserId = normalizeText(params.linkedUserId);

  if (linkedUserId) {
    if (paymentStatus === "pending") return "payment_pending";
    if (paymentStatus === "paid" || paymentStatus === "waived") return "active";
    return "joined";
  }

  if (normalizeNextSeasonInterestStatus(params.interestStatus) === "unsubscribed") {
    return "archived";
  }
  if (normalizeNextSeasonInterestStatus(params.interestStatus) === "notified") {
    return "invited";
  }

  return normalizeOnboardingPipelineStage(params.pipelineStage);
}

export function suggestPaymentMemberMatches(params: {
  payment: PaymentLedgerRecordLike;
  members: PaymentMemberCandidate[];
  maxSuggestions?: number;
}) {
  const haystack = unique([
    normalizeLowerText(params.payment.reference_text),
    normalizeLowerText(params.payment.payer_name),
    normalizeLowerText(params.payment.payer_email),
  ])
    .filter(Boolean)
    .join(" ");

  const payerEmail = normalizeEmail(params.payment.payer_email);
  const expectedAmount = getSeasonBuyInCents(params.payment.season);
  const maxSuggestions = Math.max(1, Math.trunc(params.maxSuggestions ?? 3));

  const suggestions: PaymentMatchSuggestion[] = params.members
    .map((member) => {
      let score = 0;
      const reasons: string[] = [];

      const memberEmail = normalizeEmail(member.email);
      const displayName = normalizeText(member.display_name);
      const lowerDisplayName = normalizeLowerText(member.display_name);

      if (payerEmail && memberEmail && payerEmail === memberEmail) {
        score += 120;
        reasons.push("email matches exactly");
      } else if (memberEmail && haystack.includes(memberEmail)) {
        score += 90;
        reasons.push("email appears in payer details");
      }

      if (displayName && lowerDisplayName && haystack.includes(lowerDisplayName)) {
        score += 75;
        reasons.push("display name appears in payer details");
      } else if (displayName) {
        const memberTokens = tokenize(displayName);
        const overlap = memberTokens.filter((token) => haystack.includes(token));
        if (overlap.length >= 2) {
          score += 55;
          reasons.push("multiple name parts match payer details");
        } else if (overlap.length === 1) {
          score += 22;
          reasons.push(`name token matches: ${overlap[0]}`);
        }
      }

      if (
        Number.isFinite(params.payment.amount_cents) &&
        params.payment.amount_cents > 0 &&
        params.payment.amount_cents === expectedAmount
      ) {
        score += 18;
        reasons.push("amount matches the season buy-in");
      }

      if (normalizeOnboardingPaymentStatus(member.payment_status) === "pending") {
        score += 8;
        reasons.push("member is still marked payment pending");
      }

      return {
        ...member,
        score,
        reasons,
      } satisfies PaymentMatchSuggestion;
    })
    .filter((member) => member.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const nameA = normalizeLowerText(a.display_name || a.email || a.user_id);
      const nameB = normalizeLowerText(b.display_name || b.email || b.user_id);
      return nameA.localeCompare(nameB);
    })
    .slice(0, maxSuggestions)
    .map((member) => ({
      ...member,
      reasons: unique(member.reasons),
    }));

  return suggestions;
}

export function findAutoLinkedOnboardingCandidate(params: {
  season: number;
  matchedUserId: string;
  matchedMemberEmail?: string | null;
  rows: PaymentOnboardingCandidate[];
}) {
  const matchedUserId = normalizeText(params.matchedUserId);
  const memberEmail = normalizeEmail(params.matchedMemberEmail);

  const eligibleRows = params.rows.filter((row) => {
    if (Number(row.target_season) !== Math.trunc(params.season)) return false;
    if (normalizeNextSeasonInterestStatus(row.status) === "unsubscribed") return false;
    if (normalizeOnboardingPipelineStage(row.pipeline_stage) === "archived") return false;
    return true;
  });

  const linkedRow = eligibleRows.find(
    (row) => normalizeText(row.linked_user_id) === matchedUserId
  );
  if (linkedRow) return linkedRow;

  if (!memberEmail) return null;

  return (
    eligibleRows.find((row) => {
      if (normalizeText(row.linked_user_id)) return false;
      return normalizeEmail(row.email) === memberEmail;
    }) ?? null
  );
}

export function buildLinkedOnboardingPreview(row: PaymentOnboardingCandidate | null) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email ?? null,
    full_name: row.full_name ?? null,
    derived_stage: deriveOnboardingStage({
      pipelineStage: row.pipeline_stage ?? null,
      interestStatus: row.status ?? null,
      linkedUserId: row.linked_user_id ?? null,
      membershipPaymentStatus: row.membership_payment_status ?? null,
    }),
  } satisfies PaymentLinkedOnboardingPreview;
}
