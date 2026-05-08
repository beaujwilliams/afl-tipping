const DEFAULT_SQUIGGLE_USER_AGENT =
  "Complicated Tips AFL tipping (https://www.complicatedtips.com; contact: admin@complicatedtips.com)";

export function getSquiggleUserAgent() {
  const configured = process.env.SQUIGGLE_USER_AGENT?.trim();
  return configured || DEFAULT_SQUIGGLE_USER_AGENT;
}

export function getSquiggleRequestHeaders() {
  return {
    Accept: "application/json",
    "User-Agent": getSquiggleUserAgent(),
  };
}

export async function fetchSquiggleJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: getSquiggleRequestHeaders(),
  });

  const text = await response.text();
  let json: unknown = null;
  let parseError: string | null = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    parseError = error instanceof Error ? error.message : "Failed to parse Squiggle response";
  }

  return {
    response,
    json,
    parseError,
    textHead: text.slice(0, 500),
    userAgent: getSquiggleUserAgent(),
  };
}
