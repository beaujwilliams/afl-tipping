import { NextResponse } from "next/server";
import { NEXT_SEASON } from "@/lib/season-config";
import { createServiceClient } from "@/lib/supabase-server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: unknown) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > 320) return null;
  return trimmed;
}

function normalizeName(raw: unknown) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 120);
}

function isMissingRelationError(message: string, relationName: string) {
  const m = String(message ?? "").toLowerCase();
  const rel = relationName.toLowerCase();
  return m.includes(rel) && m.includes("relation") && m.includes("does not exist");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | null
      | {
          email?: string;
          full_name?: string;
          website?: string;
        };

    // Honeypot. Treat as successful no-op for bots.
    if (body?.website && body.website.trim()) {
      return NextResponse.json({ ok: true, target_season: NEXT_SEASON });
    }

    const email = normalizeEmail(body?.email);
    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });
    }

    const fullName = normalizeName(body?.full_name);
    if (!fullName) {
      return NextResponse.json({ ok: false, error: "Please enter your name." }, { status: 400 });
    }
    const nowIso = new Date().toISOString();
    const supabase = createServiceClient();

    const { error } = await supabase.from("next_season_interest").upsert(
      {
        target_season: NEXT_SEASON,
        email,
        email_normalized: email,
        full_name: fullName,
        source: "public_form",
        status: "pending",
        submitted_at_utc: nowIso,
        updated_at: nowIso,
      },
      {
        onConflict: "target_season,email_normalized",
        ignoreDuplicates: false,
      }
    );

    if (error) {
      if (isMissingRelationError(error.message, "next_season_interest")) {
        return NextResponse.json(
          {
            ok: false,
            error: "Database is missing next_season_interest table",
            details: "Run db/migrations/20260326_next_season_interest.sql and redeploy.",
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { ok: false, error: "Could not save your interest right now.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, target_season: NEXT_SEASON });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "Could not save your interest right now.", details },
      { status: 500 }
    );
  }
}
