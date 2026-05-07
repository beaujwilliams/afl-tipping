import { NextResponse } from "next/server";

type VitalsPayload = {
  id?: string;
  name?: string;
  value?: number;
  delta?: number;
  rating?: string;
  navigationType?: string | null;
  path?: string | null;
  ts?: number;
  ua?: string | null;
  viewport?: { width?: number; height?: number } | null;
};

function sanitizePayload(payload: VitalsPayload) {
  return {
    id: String(payload.id ?? "").slice(0, 128),
    name: String(payload.name ?? "").slice(0, 32),
    value: Number(payload.value ?? 0),
    delta: Number(payload.delta ?? 0),
    rating: String(payload.rating ?? "").slice(0, 16),
    navigationType: String(payload.navigationType ?? "").slice(0, 32),
    path: String(payload.path ?? "").slice(0, 256),
    ts: Number(payload.ts ?? Date.now()),
    ua: String(payload.ua ?? "").slice(0, 512),
    viewport: {
      width: Number(payload.viewport?.width ?? 0),
      height: Number(payload.viewport?.height ?? 0),
    },
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as VitalsPayload | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const payload = sanitizePayload(body);
    if (!payload.name || !payload.id) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }

    console.log("[web-vitals]", JSON.stringify(payload));
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not record vitals" }, { status: 500 });
  }
}
