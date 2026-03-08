import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { validateUsername } from "@/lib/username";

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawUsername = url.searchParams.get("username");
    const validated = validateUsername(rawUsername);

    if (!validated.ok) {
      return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
    }

    const username = validated.value;
    const service = createServiceClient();

    const existing = await service
      .from("profiles")
      .select("id")
      .eq("username", username)
      .limit(1)
      .maybeSingle();

    if (existing.error) {
      if (isMissingColumnError(existing.error.message, "username")) {
        return NextResponse.json(
          {
            ok: false,
            error: "Database is missing profiles.username",
            details: "Run db/migrations/20260309_profiles_username.sql and redeploy.",
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { ok: false, error: "Failed to check username", details: existing.error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      username,
      available: !existing.data,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "Unexpected error", details }, { status: 500 });
  }
}

