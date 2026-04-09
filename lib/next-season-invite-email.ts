export const RESEND_RATE_LIMIT_RETRY_ATTEMPTS = 3;
export const MIN_SEND_SPACING_MS = 1100;

export type SeasonOpenSendStatus = "sent" | "simulated" | "failed";

export type SeasonOpenSendResult = {
  status: SeasonOpenSendStatus;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
};

export function normalizeSeasonOpenRecipientName(
  name: string | null | undefined,
  email: string
) {
  const trimmed = String(name ?? "").trim();
  if (trimmed) return trimmed;
  return email.split("@")[0] || "there";
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function getRetryDelayMsFromHeaders(headers: Headers, attempt: number) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      const delta = dateMs - Date.now();
      if (delta > 0) return delta;
    }
  }

  const resetRaw = headers.get("x-ratelimit-reset") ?? headers.get("ratelimit-reset");
  if (resetRaw) {
    const reset = Number(resetRaw);
    if (Number.isFinite(reset) && reset > 0) {
      const resetMs = reset > 1_000_000_000_000 ? reset : reset * 1000;
      const delta = Math.ceil(resetMs - Date.now());
      if (delta > 0) return delta;
    }
  }

  return Math.min(4000, 500 * 2 ** Math.max(0, attempt - 1));
}

export function buildSeasonOpenSignupUrl() {
  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || "https://www.complicatedtips.com").replace(/\/+$/, "");
  return `${siteUrl}/signup`;
}

export async function sendSeasonOpenEmail(params: {
  apiKey: string;
  fromEmail: string;
  replyTo: string | null;
  toEmail: string;
  displayName: string;
  season: number;
  signupUrl: string;
  dryRun: boolean;
}): Promise<SeasonOpenSendResult> {
  if (params.dryRun) {
    return {
      status: "simulated",
      provider: null,
      providerMessageId: null,
      error: null,
    };
  }

  const subject = `AFL Tipping Season ${params.season}: signups are now open`;
  const text = [
    `Hi ${params.displayName},`,
    "",
    `Great news — signups for AFL Tipping Season ${params.season} are now open.`,
    `Create your account here: ${params.signupUrl}`,
    "",
    "Needlessly Complicated AFL Tipping",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.45; color: #111;">
      <p>Hi ${params.displayName},</p>
      <p><b>Great news</b> — signups for AFL Tipping Season ${params.season} are now open.</p>
      <p><a href="${params.signupUrl}">Create your account</a></p>
      <p style="margin-top: 24px;">Needlessly Complicated AFL Tipping</p>
    </div>
  `;

  const payload: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
    reply_to?: string;
  } = {
    from: params.fromEmail,
    to: [params.toEmail],
    subject,
    text,
    html,
  };

  if (params.replyTo) payload.reply_to = params.replyTo;

  for (let attempt = 1; attempt <= RESEND_RATE_LIMIT_RETRY_ATTEMPTS; attempt += 1) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await res.text();
    let bodyJson: unknown = null;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = null;
    }

    if (res.ok) {
      const providerMessageId =
        typeof bodyJson === "object" &&
        bodyJson !== null &&
        "id" in bodyJson &&
        typeof (bodyJson as { id?: unknown }).id === "string"
          ? (bodyJson as { id: string }).id
          : null;

      return {
        status: "sent",
        provider: "resend",
        providerMessageId,
        error: null,
      };
    }

    const errHead = bodyText.slice(0, 300);
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < RESEND_RATE_LIMIT_RETRY_ATTEMPTS) {
      const delayMs = getRetryDelayMsFromHeaders(res.headers, attempt);
      await sleep(delayMs);
      continue;
    }

    return {
      status: "failed",
      provider: "resend",
      providerMessageId: null,
      error: `Resend error ${res.status}: ${errHead}`,
    };
  }

  return {
    status: "failed",
    provider: "resend",
    providerMessageId: null,
    error: "Resend error: retry attempts exhausted",
  };
}
