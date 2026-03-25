import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase-server";
import {
  type AuthOtpType,
  getSafeNextPath,
  resolvePostAuthRedirectPath,
} from "@/lib/auth-callback-routing";
import { isDuplicateUsernameError, validateUsername } from "@/lib/username";

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

async function bootstrapProfileFromSignupMetadata(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return;

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const rawDisplayName =
    typeof metadata.display_name === "string" ? metadata.display_name.trim() : "";
  const usernameValidated = validateUsername(
    typeof metadata.username === "string" ? metadata.username : null
  );
  const username = usernameValidated.ok ? usernameValidated.value : null;

  const service = createServiceClient();

  let profile:
    | {
        id: string;
        display_name: string | null;
        username?: string | null;
      }
    | null = null;
  let usernameColumnAvailable = true;

  const withUsername = await service
    .from("profiles")
    .select("id, display_name, username")
    .eq("id", user.id)
    .maybeSingle();

  if (withUsername.error && isMissingColumnError(withUsername.error.message, "username")) {
    usernameColumnAvailable = false;
    const fallback = await service
      .from("profiles")
      .select("id, display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (fallback.error) return;
    profile = (fallback.data as { id: string; display_name: string | null } | null) ?? null;
  } else if (withUsername.error) {
    return;
  } else {
    profile =
      (withUsername.data as { id: string; display_name: string | null; username?: string | null } | null) ?? null;
  }

  const update: { id: string; display_name?: string | null; username?: string | null } = {
    id: user.id,
  };
  let shouldUpsert = false;

  const existingDisplayName = String(profile?.display_name ?? "").trim();
  const existingUsername = String(profile?.username ?? "").trim();

  if (!existingDisplayName) {
    const displayName = rawDisplayName || username || "";
    if (displayName) {
      update.display_name = displayName;
      shouldUpsert = true;
    }
  }

  if (usernameColumnAvailable && username && !existingUsername) {
    update.username = username;
    shouldUpsert = true;
  }

  if (!shouldUpsert) return;

  const upsert = await service.from("profiles").upsert(update, { onConflict: "id" });
  if (!upsert.error) return;

  if (isMissingColumnError(upsert.error.message, "username") && update.username !== undefined) {
    delete update.username;
    await service.from("profiles").upsert(update, { onConflict: "id" });
    return;
  }

  if (isDuplicateUsernameError(upsert.error.message)) {
    if (update.display_name !== undefined) {
      await service
        .from("profiles")
        .upsert({ id: user.id, display_name: update.display_name }, { onConflict: "id" });
    }
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type"); // usually "magiclink"
  const nextPath = getSafeNextPath(url.searchParams.get("next"));

  const supabase = await createClient();

  // Handle PKCE / OAuth-style callback
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
      );
    }

    const redirectPath = resolvePostAuthRedirectPath({
      flow: "code",
      type,
      nextPath,
    });

    if (redirectPath === "/reset-password") {
      return NextResponse.redirect(new URL(redirectPath, url.origin));
    }

    await bootstrapProfileFromSignupMetadata(supabase);
    return NextResponse.redirect(new URL(redirectPath, url.origin));
  }

  // Handle Supabase magic link callback
  if (token_hash && type) {
    const allowedTypes: AuthOtpType[] = [
      "signup",
      "invite",
      "magiclink",
      "recovery",
      "email_change",
      "email",
    ];

    if (!allowedTypes.includes(type as AuthOtpType)) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent("Invalid callback type")}`, url.origin)
      );
    }

    const otpType = type as AuthOtpType;

    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: otpType,
    });

    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
      );
    }

    const redirectPath = resolvePostAuthRedirectPath({
      flow: "otp",
      type,
      otpType,
      nextPath,
    });

    if (redirectPath === "/reset-password") {
      return NextResponse.redirect(new URL(redirectPath, url.origin));
    }

    await bootstrapProfileFromSignupMetadata(supabase);
    return NextResponse.redirect(new URL(redirectPath, url.origin));
  }

  // Nothing we understand in the URL
  return NextResponse.redirect(new URL("/login?error=Missing+callback+params", url.origin));
}
