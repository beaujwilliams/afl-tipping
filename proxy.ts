import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(_req: NextRequest) {
  // ✅ Do NOT gate pages here.
  // Supabase auth in this app is client-side (localStorage), so server-side redirects
  // will incorrectly send logged-in users to /login in production.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};