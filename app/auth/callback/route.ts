import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type"); // usually "magiclink"

  const supabase = await createClient();

  // Handle PKCE / OAuth-style callback
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
      );
    }
    return NextResponse.redirect(new URL("/setup", url.origin));
  }

  // Handle Supabase magic link callback
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as any,
    });

    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
      );
    }
    return NextResponse.redirect(new URL("/setup", url.origin));
  }

  // Nothing we understand in the URL
  return NextResponse.redirect(new URL("/login?error=Missing+callback+params", url.origin));
}