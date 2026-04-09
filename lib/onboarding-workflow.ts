export type NextSeasonInterestStatus = "pending" | "notified" | "unsubscribed";

export type OnboardingPipelineStage =
  | "new"
  | "reviewed"
  | "contacted"
  | "invited"
  | "joined"
  | "payment_pending"
  | "active"
  | "archived";

export type OnboardingDerivedStage =
  | OnboardingPipelineStage
  | "payment_pending"
  | "active";

export type OnboardingPaymentStatus = "paid" | "pending" | "waived" | null;

export type OnboardingTransitionSource = OnboardingPipelineStage | null | undefined;

const STAGE_ORDER: OnboardingPipelineStage[] = [
  "new",
  "reviewed",
  "contacted",
  "invited",
  "joined",
  "payment_pending",
  "active",
  "archived",
];

export function normalizeNextSeasonInterestStatus(
  raw: string | null | undefined
): NextSeasonInterestStatus {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();

  if (value === "pending" || value === "notified" || value === "unsubscribed") {
    return value;
  }

  return "pending";
}

export function normalizeOnboardingPipelineStage(
  raw: string | null | undefined
): OnboardingPipelineStage {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();

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

export function normalizeOnboardingPaymentStatus(
  raw: string | null | undefined
): OnboardingPaymentStatus {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();

  if (value === "paid" || value === "pending" || value === "waived") {
    return value;
  }

  return null;
}

export function inferInitialOnboardingStageFromInterestStatus(
  status: string | null | undefined
): OnboardingPipelineStage {
  const normalizedStatus = normalizeNextSeasonInterestStatus(status);
  if (normalizedStatus === "notified") return "invited";
  if (normalizedStatus === "unsubscribed") return "archived";
  return "new";
}

export function deriveOnboardingStage(params: {
  pipelineStage?: string | null;
  interestStatus?: string | null;
  linkedUserId?: string | null;
  membershipPaymentStatus?: string | null;
}): OnboardingDerivedStage {
  const paymentStatus = normalizeOnboardingPaymentStatus(params.membershipPaymentStatus);
  const linkedUserId = String(params.linkedUserId ?? "").trim();

  if (linkedUserId) {
    if (paymentStatus === "pending") return "payment_pending";
    if (paymentStatus === "paid" || paymentStatus === "waived") return "active";
    return "joined";
  }

  const stage = normalizeOnboardingPipelineStage(
    params.pipelineStage ?? inferInitialOnboardingStageFromInterestStatus(params.interestStatus)
  );

  return stage;
}

export function canTransitionOnboardingStage(params: {
  from: OnboardingTransitionSource;
  to: OnboardingPipelineStage;
}) {
  const from = normalizeOnboardingPipelineStage(params.from ?? "new");
  const to = normalizeOnboardingPipelineStage(params.to);

  if (from === to) return true;
  if (to === "archived" && from !== "active") return true;
  if (from === "archived" && to === "reviewed") return true;

  const allowedNextByStage: Record<
    Exclude<OnboardingPipelineStage, "archived" | "active">,
    OnboardingPipelineStage[]
  > = {
    new: ["reviewed"],
    reviewed: ["contacted"],
    contacted: ["invited"],
    invited: ["joined"],
    joined: ["payment_pending"],
    payment_pending: ["active"],
  };

  if (from === "active" || from === "archived") return false;
  return allowedNextByStage[from as keyof typeof allowedNextByStage]?.includes(to) ?? false;
}

export function nextSuggestedOnboardingStage(
  stage: OnboardingTransitionSource
): OnboardingPipelineStage | null {
  const normalized = normalizeOnboardingPipelineStage(stage ?? "new");
  if (normalized === "new") return "reviewed";
  if (normalized === "reviewed") return "contacted";
  if (normalized === "contacted") return "invited";
  if (normalized === "invited") return "joined";
  if (normalized === "joined") return "payment_pending";
  if (normalized === "payment_pending") return "active";
  return null;
}

export function summarizeOnboardingStages(
  rows: Array<{
    pipelineStage?: string | null;
    interestStatus?: string | null;
    linkedUserId?: string | null;
    membershipPaymentStatus?: string | null;
  }>
) {
  const counts: Record<OnboardingDerivedStage, number> = {
    new: 0,
    reviewed: 0,
    contacted: 0,
    invited: 0,
    joined: 0,
    payment_pending: 0,
    active: 0,
    archived: 0,
  };

  rows.forEach((row) => {
    const stage = deriveOnboardingStage(row);
    counts[stage] += 1;
  });

  return counts;
}

export function sortOnboardingStagesForDisplay(stages: OnboardingPipelineStage[]) {
  return [...stages].sort(
    (a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b)
  );
}
