import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(_req: NextRequest) {
  // ✅ No server-side auth gating (because session is in browser localStorage).
  // Each page handles redirects to /login on the client.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};