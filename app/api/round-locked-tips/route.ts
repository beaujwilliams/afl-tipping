import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { resolveReigningChampion } from "@/lib/reigning-champion";
import { resolveCompetitionIdForSeasonRound } from "@/lib/competition-resolver";

type PlayerRow = {
  user_id: string;
  display_name: string | null;
  payment_status?: string | null;
  potential: number;
  picks: Record<string, { team: string; odds: number }>;
};

type MembershipRow = {
  user_id: string;
  payment_status?: string | null;
};

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function normalizePaymentStatus(status: string | null | undefined) {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (s === "paid" || s === "pending" || s === "waived") return s;
  return null;
}

async function getPaymentStatusByUserId(
  supabase: ReturnType<typeof createServiceClient>,
  competitionId: string,
  userIds: string[]
) {
  const out: Record<string, string | null> = {};
  if (!userIds.length) return out;

  const withPayment = await supabase
    .from("memberships")
    .select("user_id, payment_status")
    .eq("competition_id", competitionId)
    .in("user_id", userIds);

  if (withPayment.error && isMissingColumnError(withPayment.error.message, "payment_status")) {
    const fallback = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", competitionId)
      .in("user_id", userIds);

    if (fallback.error) throw new Error(fallback.error.message);

    (fallback.data as MembershipRow[] | null)?.forEach((m) => {
      out[String(m.user_id)] = null;
    });
    return out;
  }

  if (withPayment.error) throw new Error(withPayment.error.message);

  (withPayment.data as MembershipRow[] | null)?.forEach((m) => {
    out[String(m.user_id)] = normalizePaymentStatus(m.payment_status ?? null);
  });

  return out;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season"));
    const round = Number(url.searchParams.get("round"));
    const competitionIdParam = url.searchParams.get("competition_id");

    if (!Number.isFinite(season) || !Number.isFinite(round) || round < 0) {
      return NextResponse.json(
        { ok: false, error: "Provide valid season and round" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const competitionId = await resolveCompetitionIdForSeasonRound({
      season,
      round,
      explicitCompetitionId: competitionIdParam,
      supabase,
    });

    if (!competitionId) {
      return NextResponse.json({ ok: false, error: "No competition" }, { status: 404 });
    }

    const reigningChampion = await resolveReigningChampion({
      competitionId,
      season,
      supabase,
    });

    const { data: roundRow, error: rErr } = await supabase
      .from("rounds")
      .select("id, lock_time_utc, odds_snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .eq("season", season)
      .eq("round_number", round)
      .single();

    if (rErr || !roundRow) {
      return NextResponse.json({ ok: false, error: "Round not found" }, { status: 404 });
    }

    const roundId = String((roundRow as any).id);
    const snapshotForTimeUtc = (roundRow as any).odds_snapshot_for_time_utc ?? null;
    const lockTimeUtc = (roundRow as any).lock_time_utc ?? null;
    const lockMs = lockTimeUtc ? new Date(lockTimeUtc).getTime() : NaN;

    if (!Number.isFinite(lockMs) || Date.now() < lockMs) {
      return NextResponse.json(
        {
          ok: false,
          error: "Everyone’s tips are available only after the round locks.",
          lock_time_utc: lockTimeUtc,
        },
        { status: 403 }
      );
    }

    const { data: cached, error: cacheErr } = await supabase
      .from("round_locked_tips_cache")
      .select("players, computed_at")
      .eq("competition_id", competitionId)
      .eq("round_id", roundId)
      .maybeSingle();

    if (!cacheErr && cached?.players) {
      const cachedPlayers = (cached.players as PlayerRow[]) ?? [];
      const cachedUserIds = Array.from(new Set(cachedPlayers.map((p) => String(p.user_id))));
      const paymentStatusByUserId = await getPaymentStatusByUserId(
        supabase,
        competitionId,
        cachedUserIds
      );

      const playersWithPayment = cachedPlayers.map((p) => ({
        ...p,
        payment_status: paymentStatusByUserId[String(p.user_id)] ?? null,
      }));

      return NextResponse.json({
        ok: true,
        season,
        round,
        reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
        players: playersWithPayment,
        cached: true,
        computed_at: cached.computed_at,
      });
    }

    const { data: matches, error: mErr } = await supabase
      .from("matches")
      .select("id, home_team, away_team")
      .eq("round_id", roundId);

    if (mErr) {
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
    }

    const matchList = (matches ?? []) as any[];
    const matchIds = matchList.map((m) => String(m.id));

    if (matchIds.length === 0) {
      const players: PlayerRow[] = [];

      await supabase.from("round_locked_tips_cache").upsert({
        competition_id: competitionId,
        round_id: roundId,
        season,
        round_number: round,
        snapshot_for_time_utc: snapshotForTimeUtc,
        computed_at: new Date().toISOString(),
        players,
      });

      return NextResponse.json({
        ok: true,
        season,
        round,
        reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
        players,
        cached: false,
      });
    }

    const matchById: Record<string, { home: string; away: string }> = {};
    for (const m of matchList) {
      matchById[String(m.id)] = { home: String(m.home_team), away: String(m.away_team) };
    }

    const { data: tips, error: tErr } = await supabase
      .from("tips")
      .select("match_id, user_id, picked_team")
      .eq("competition_id", competitionId)
      .in("match_id", matchIds);

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    const tipRows = (tips ?? []) as any[];

    if (tipRows.length === 0) {
      const players: PlayerRow[] = [];

      await supabase.from("round_locked_tips_cache").upsert({
        competition_id: competitionId,
        round_id: roundId,
        season,
        round_number: round,
        snapshot_for_time_utc: snapshotForTimeUtc,
        computed_at: new Date().toISOString(),
        players,
      });

      return NextResponse.json({
        ok: true,
        season,
        round,
        reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
        players,
        cached: false,
      });
    }

    const userIds = Array.from(new Set(tipRows.map((t: any) => String(t.user_id))));
    const paymentStatusByUserId = await getPaymentStatusByUserId(supabase, competitionId, userIds);

    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    if (pErr) {
      return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
    }

    const nameById: Record<string, string | null> = {};
    (profs ?? []).forEach((p: any) => {
      nameById[String(p.id)] = p.display_name ?? null;
    });

    let oddsQuery = supabase
      .from("match_odds")
      .select("match_id, home_odds, away_odds, captured_at_utc, snapshot_for_time_utc")
      .eq("competition_id", competitionId)
      .in("match_id", matchIds);

    if (snapshotForTimeUtc) {
      oddsQuery = oddsQuery.eq("snapshot_for_time_utc", snapshotForTimeUtc);
    } else {
      oddsQuery = oddsQuery.order("snapshot_for_time_utc", { ascending: false });
    }

    oddsQuery = oddsQuery.order("captured_at_utc", { ascending: false });

    const { data: oddsRows, error: oErr } = await oddsQuery;

    if (oErr) {
      return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 });
    }

    const oddsByMatchId: Record<string, { home_odds: number; away_odds: number }> = {};
    for (const row of (oddsRows ?? []) as any[]) {
      const mid = String(row.match_id);
      if (oddsByMatchId[mid]) continue;
      oddsByMatchId[mid] = {
        home_odds: Number(row.home_odds ?? 0),
        away_odds: Number(row.away_odds ?? 0),
      };
    }

    const byUser: Record<string, PlayerRow> = {};

    for (const t of tipRows) {
      const uid = String(t.user_id);
      const matchId = String(t.match_id);
      const team = String(t.picked_team ?? "");
      if (!team) continue;

      const matchTeams = matchById[matchId];
      if (!matchTeams) continue;

      if (!byUser[uid]) {
        byUser[uid] = {
          user_id: uid,
          display_name: nameById[uid] ?? null,
          payment_status: paymentStatusByUserId[uid] ?? null,
          potential: 0,
          picks: {},
        };
      }

      const o = oddsByMatchId[matchId];
      let odds = 0;

      if (o) {
        if (team === matchTeams.home) odds = o.home_odds;
        else if (team === matchTeams.away) odds = o.away_odds;
      }

      byUser[uid].picks[matchId] = { team, odds };
      byUser[uid].potential += odds;
    }

    const players = Object.values(byUser).sort((a, b) => Number(b.potential) - Number(a.potential));

    await supabase.from("round_locked_tips_cache").upsert({
      competition_id: competitionId,
      round_id: roundId,
      season,
      round_number: round,
      snapshot_for_time_utc: snapshotForTimeUtc,
      computed_at: new Date().toISOString(),
      players,
    });

    return NextResponse.json({
      ok: true,
      season,
      round,
      reigning_champion_user_id: reigningChampion.reigning_champion_user_id,
      players,
      cached: false,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
