import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? new Date().getFullYear());
    const force = url.searchParams.get("force") === "1";
    const limit = Number(url.searchParams.get("limit") ?? "0"); // 0 = unlimited

    // ---------------------------
    // Auth: verify Bearer token
    // ---------------------------
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    const cookieStore = cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get() {
            return undefined;
          },
          set() {},
          remove() {},
        },
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    if (user.email !== ADMIN_EMAIL) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // ---------------------------
    // Fetch rounds for season
    // ---------------------------
    const { data: rounds, error: roundsError } = await supabase
      .from("rounds")
      .select("*")
      .eq("season", season)
      .order("round", { ascending: true });

    if (roundsError) {
      return NextResponse.json({ error: "Failed to read rounds", details: roundsError.message }, { status: 500 });
    }

    if (!rounds?.length) {
      return NextResponse.json({
        ok: true,
        season,
        processedDueRounds: 0,
        capturedRounds: 0,
        note: "No rounds found",
      });
    }

    const now = new Date();
    let processedDueRounds = 0;
    let capturedRounds = 0;
    const results: any[] = [];

    // ---------------------------
    // Loop rounds
    // ---------------------------
    for (const round of rounds) {
      const lockTime = new Date(round.lock_time_utc);
      const due = force || now >= lockTime;

      if (!due) {
        results.push({
          round: round.round,
          due: false,
          snapshotForTimeUtc: round.lock_time_utc,
          note: "Not due yet",
        });
        continue;
      }

      processedDueRounds++;

      // ---------------------------
      // Call snapshot-odds route
      // ---------------------------
      const snapshotUrl = `${url.origin}/api/admin/snapshot-odds?season=${season}&round=${round.round}`;

      const snapshotRes = await fetch(snapshotUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      let snapshotResult: any;
      try {
        snapshotResult = await snapshotRes.json();
      } catch {
        const text = await snapshotRes.text();
        snapshotResult = {
          error: "Non-JSON response",
          status: snapshotRes.status,
          bodyHead: text.slice(0, 800),
        };
      }

      if (snapshotRes.status === 200) {
        capturedRounds++;
      }

      results.push({
        round: round.round,
        due: true,
        snapshotForTimeUtc: round.lock_time_utc,
        status: snapshotRes.status,
        snapshotResult,
      });

      // ---------------------------
      // LIMIT SUPPORT (new)
      // ---------------------------
      if (limit > 0 && capturedRounds >= limit) {
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      season,
      processedDueRounds,
      capturedRounds,
      results,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Unexpected error",
        details: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}