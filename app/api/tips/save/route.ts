import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase-server";
import { resolveCompetitionIdForSeasonRound } from "@/lib/competition-resolver";
import { getBearer } from "@/lib/admin-auth";
import {
  isRoundLocked,
  normalizePaymentStatus,
  normalizeRole,
  shouldBlockTipSubmissionForPayment,
} from "@/lib/scoring-lock-rules";

type SaveTipBody = {
  season?: number;
  round?: number;
  competition_id?: string;
  match_id?: string;
  picked_team?: string;
};

type CompetitionWithLock = {
  id: string;
  enforce_unpaid_tip_lock: boolean | null;
};

type MembershipRow = {
  role: string | null;
  payment_status: string | null;
};

type RoundRow = {
  id: string;
  lock_time_utc: string | null;
};

type MatchRow = {
  id: string;
  home_team: string;
  away_team: string;
};

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

async function getUserFromBearer(req: Request) {
  const token = getBearer(req);
  if (!token) return null;

  const authClient = createSupabaseClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function getAuthedUser(req: Request) {
  const fromBearer = await getUserFromBearer(req);
  if (fromBearer) return fromBearer;

  const authClient = await createClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export async function POST(req: Request) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as SaveTipBody | null;
    const season = Number(body?.season);
    const round = Number(body?.round);
    const matchId = String(body?.match_id ?? "").trim();
    const pickedTeam = String(body?.picked_team ?? "").trim();

    if (!Number.isFinite(season) || !Number.isFinite(round) || round < 0) {
      return NextResponse.json(
        { error: "Provide valid season and round" },
        { status: 400 }
      );
    }

    if (!matchId || !pickedTeam) {
      return NextResponse.json(
        { error: "Missing match_id or picked_team" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const competitionId = await resolveCompetitionIdForSeasonRound({
      season,
      round,
      explicitCompetitionId:
        typeof body?.competition_id === "string" ? body.competition_id.trim() : null,
      userId: user.id,
      supabase,
    });

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    let enforceUnpaidTipLock = false;

    const compWithLock = await supabase
      .from("competitions")
      .select("id, enforce_unpaid_tip_lock")
      .eq("id", competitionId)
      .single();

    if (!compWithLock.error && compWithLock.data?.id) {
      enforceUnpaidTipLock = !!(compWithLock.data as CompetitionWithLock).enforce_unpaid_tip_lock;
    } else {
      const compFallback = await supabase
        .from("competitions")
        .select("id")
        .eq("id", competitionId)
        .single();

      if (compFallback.error || !compFallback.data?.id) {
        return NextResponse.json({ error: "No competition found" }, { status: 404 });
      }

      enforceUnpaidTipLock = false;
    }

    const membership = await supabase
      .from("memberships")
      .select("role, payment_status")
      .eq("competition_id", competitionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membership.error && isMissingColumnError(membership.error.message, "payment_status")) {
      const membershipFallback = await supabase
        .from("memberships")
        .select("role")
        .eq("competition_id", competitionId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipFallback.error || !membershipFallback.data) {
        return NextResponse.json(
          { error: "You are not a member of this competition" },
          { status: 403 }
        );
      }

      const role = normalizeRole(
        (membershipFallback.data as { role?: string | null }).role ?? null
      );

      if (
        shouldBlockTipSubmissionForPayment({
          enforceUnpaidTipLock,
          role,
          paymentStatus: "pending",
        })
      ) {
        return NextResponse.json(
          {
            error: "Tip submissions are locked for unpaid members.",
            code: "unpaid_locked",
            payment_status: "pending",
          },
          { status: 403 }
        );
      }
    } else {
      if (membership.error || !membership.data) {
        return NextResponse.json(
          { error: "You are not a member of this competition" },
          { status: 403 }
        );
      }

      const row = membership.data as MembershipRow;
      const role = normalizeRole(row.role);
      const paymentStatus = normalizePaymentStatus(row.payment_status);

      if (
        shouldBlockTipSubmissionForPayment({
          enforceUnpaidTipLock,
          role,
          paymentStatus,
        })
      ) {
        return NextResponse.json(
          {
            error: "Tip submissions are locked for unpaid members.",
            code: "unpaid_locked",
            payment_status: paymentStatus,
          },
          { status: 403 }
        );
      }
    }

    const roundQuery = await supabase
      .from("rounds")
      .select("id, lock_time_utc")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .eq("round_number", round)
      .single();

    if (roundQuery.error || !roundQuery.data?.id) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }

    const roundRow = roundQuery.data as RoundRow;
    const lockTimeUtc = roundRow.lock_time_utc ?? null;
    if (isRoundLocked(lockTimeUtc)) {
      return NextResponse.json(
        {
          error: "Round locked — tips cannot be changed.",
          code: "round_locked",
          lock_time_utc: lockTimeUtc,
        },
        { status: 403 }
      );
    }

    const matchQuery = await supabase
      .from("matches")
      .select("id, home_team, away_team")
      .eq("round_id", roundRow.id)
      .eq("id", matchId)
      .maybeSingle();

    if (matchQuery.error || !matchQuery.data) {
      return NextResponse.json({ error: "Match not found in this round" }, { status: 404 });
    }

    const match = matchQuery.data as MatchRow;
    if (pickedTeam !== match.home_team && pickedTeam !== match.away_team) {
      return NextResponse.json(
        { error: "picked_team must match the home or away team for this match" },
        { status: 400 }
      );
    }

    const { error: upsertErr } = await supabase.from("tips").upsert(
      {
        competition_id: competitionId,
        user_id: user.id,
        match_id: matchId,
        picked_team: pickedTeam,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "match_id,user_id" }
    );

    if (upsertErr) {
      return NextResponse.json(
        { error: "Failed to save tip", details: upsertErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      season,
      round,
      match_id: matchId,
      picked_team: pickedTeam,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Unexpected error", details },
      { status: 500 }
    );
  }
}
