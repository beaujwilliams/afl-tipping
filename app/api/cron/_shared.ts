import { NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/admin-auth";

export const DEFAULT_SEASON = 2026;

type ForwardCronToAdminOptions = {
  season?: number | null;
  jobKind?: string | null;
};

export function parseSeason(req: Request) {
  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season") ?? String(DEFAULT_SEASON));
  if (!Number.isFinite(season) || season < 2000 || season > 2100) {
    return null;
  }
  return Math.trunc(season);
}

function withSecret(pathWithQuery: string, secret: string) {
  const joiner = pathWithQuery.includes("?") ? "&" : "?";
  return `${pathWithQuery}${joiner}secret=${encodeURIComponent(secret)}`;
}

export async function forwardCronToAdmin(
  req: Request,
  pathWithQuery: string,
  _options?: ForwardCronToAdminOptions
) {
  void _options;
  const gate = await requireAdminOrCron(req);
  if (!gate.ok) {
    return NextResponse.json(gate.json, { status: gate.status });
  }

  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  const path =
    gate.mode === "cron" ? withSecret(pathWithQuery, gate.secret) : pathWithQuery;

  if (gate.mode === "bearer") {
    headers.Authorization = `Bearer ${gate.token}`;
  }

  const res = await fetch(`${url.origin}${path}`, {
    headers,
    cache: "no-store",
  });

  const text = await res.text();
  let body: Record<string, unknown>;
  let status = res.status;

  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    status = 502;
    body = {
      error: "Non-JSON response from admin endpoint",
      status: res.status,
      bodyHead: text.slice(0, 500),
    };
  }

  return NextResponse.json(body, { status });
}
