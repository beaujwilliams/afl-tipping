import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(_req: NextRequest) {
  // ✅ No auth gating here (sessions are client-side/localStorage)
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};