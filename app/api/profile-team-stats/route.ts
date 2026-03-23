import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { AFL_TEAMS } from "@/lib/afl-teams";
import { getBearer } from "@/lib/admin-auth";
import { pointsForWinningTip } from "@/lib/scoring-lock-rules";
import { createClient, createServiceClient } from "@/lib/supabase-server";

type RoundRow = {
  id: string;
  competition_id: string;
  round_number: number;
  odds_snapshot_for_time_utc: string | null;
};

type MatchRow = {
  id: string;
  round_id: string;
  home_team: string;
  away_team: string;
  winner_team: string | null;
};

type OddsRow = {
  match_id: string;
  home_odds: number | null;
  away_odds: number | null;
  snapshot_for_time_utc: string | null;
  captured_at_utc: string;
};

type TipRow = {
  match_id: string;
  picked_team: string | null;
};

type TeamRow = {
  team: string;
  tipped_count: number;
  correct_count: number;
  incorrect_count: number;
  accuracy_pct: number;
  total_points: number;
  avg_points_per_tip: number;
  avg_points_per_correct: number;
};

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function round2(value: number) {
  return Number(Number(value ?? 0).toFixed(2));
}

function round1(value: number) {
  return Number(Number(value ?? 0).toFixed(1));
}

function pickCompetitionIdForSeason(roundRows: RoundRow[]) {
  if (!roundRows.length) return null;

  const byCompetition = new Map<string, number>();
  for (const row of roundRows) {
    const competitionId = String(row.competition_id);
    byCompetition.set(competitionId, (byCompetition.get(competitionId) ?? 0) + 1);
  }

  return Array.from(byCompetition.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  })[0]?.[0] ?? null;
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

export async function GET(req: Request) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") ?? "2026");
    if (!Number.isFinite(season)) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: rounds, error: roundsErr } = await supabase
      .from("rounds")
      .select("id, competition_id, round_number, odds_snapshot_for_time_utc")
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (roundsErr) {
      return NextResponse.json(
        { error: "Failed to read rounds", details: roundsErr.message },
        { status: 500 }
      );
    }

    const allSeasonRounds = (rounds ?? []) as RoundRow[];
    const competitionId = pickCompetitionIdForSeason(allSeasonRounds);
    if (!competitionId) {
      const rows = AFL_TEAMS.map((team) => ({
        team,
        tipped_count: 0,
        correct_count: 0,
        incorrect_count: 0,
        accuracy_pct: 0,
        total_points: 0,
        avg_points_per_tip: 0,
        avg_points_per_correct: 0,
      }));
      return NextResponse.json({
        ok: true,
        season,
        competition_id: null,
        totals: {
          tipped: 0,
          correct: 0,
          incorrect: 0,
          total_points: 0,
        },
        rows,
      });
    }

    const roundRows = allSeasonRounds.filter((row) => String(row.competition_id) === competitionId);
    const roundById = new Map(roundRows.map((row) => [String(row.id), row]));
    const roundIds = roundRows.map((row) => String(row.id));

    if (!roundIds.length) {
      return NextResponse.json({
        ok: true,
        season,
        competition_id: competitionId,
        totals: {
          tipped: 0,
          correct: 0,
          incorrect: 0,
          total_points: 0,
        },
        rows: [],
      });
    }

    const { data: matches, error: matchesErr } = await supabase
      .from("matches")
      .select("id, round_id, home_team, away_team, winner_team")
      .in("round_id", roundIds)
      .order("commence_time_utc", { ascending: true });

    if (matchesErr) {
      return NextResponse.json(
        { error: "Failed to read matches", details: matchesErr.message },
        { status: 500 }
      );
    }

    const matchRows = (matches ?? []) as MatchRow[];

    const lockedSnapshotByMatchId = new Map<string, string>();
    const candidateMatchIds: string[] = [];
    for (const match of matchRows) {
      const round = roundById.get(String(match.round_id));
      if (!round) continue;
      const winner = String(match.winner_team ?? "").trim();
      const snapshot = String(round.odds_snapshot_for_time_utc ?? "").trim();
      if (!winner || !snapshot) continue;

      const matchId = String(match.id);
      candidateMatchIds.push(matchId);
      lockedSnapshotByMatchId.set(matchId, snapshot);
    }

    const oddsByMatchId = new Map<string, { home_odds: number; away_odds: number }>();
    if (candidateMatchIds.length > 0) {
      const uniqueSnapshots = Array.from(new Set(Array.from(lockedSnapshotByMatchId.values())));
      const { data: odds, error: oddsErr } = await supabase
        .from("match_odds")
        .select("match_id, home_odds, away_odds, snapshot_for_time_utc, captured_at_utc")
        .eq("competition_id", competitionId)
        .in("match_id", candidateMatchIds)
        .in("snapshot_for_time_utc", uniqueSnapshots)
        .order("captured_at_utc", { ascending: false });

      if (oddsErr) {
        return NextResponse.json(
          { error: "Failed to read match odds", details: oddsErr.message },
          { status: 500 }
        );
      }

      for (const row of (odds ?? []) as OddsRow[]) {
        const matchId = String(row.match_id);
        if (oddsByMatchId.has(matchId)) continue;

        const lockedSnapshot = lockedSnapshotByMatchId.get(matchId);
        const rowSnapshot = String(row.snapshot_for_time_utc ?? "");
        if (!lockedSnapshot || rowSnapshot !== lockedSnapshot) continue;

        oddsByMatchId.set(matchId, {
          home_odds: Number(row.home_odds ?? 0),
          away_odds: Number(row.away_odds ?? 0),
        });
      }
    }

    const scoredMatches = new Map<string, MatchRow & { home_odds: number; away_odds: number }>();
    for (const match of matchRows) {
      const matchId = String(match.id);
      const winner = String(match.winner_team ?? "").trim();
      if (!winner) continue;
      const odds = oddsByMatchId.get(matchId);
      if (!odds) continue;
      scoredMatches.set(matchId, {
        ...match,
        home_odds: odds.home_odds,
        away_odds: odds.away_odds,
      });
    }

    const scoredMatchIds = Array.from(scoredMatches.keys());
    let tips: TipRow[] = [];
    if (scoredMatchIds.length > 0) {
      const { data: tipRows, error: tipsErr } = await supabase
        .from("tips")
        .select("match_id, picked_team")
        .eq("competition_id", competitionId)
        .eq("user_id", user.id)
        .in("match_id", scoredMatchIds);

      if (tipsErr) {
        return NextResponse.json(
          { error: "Failed to read tips", details: tipsErr.message },
          { status: 500 }
        );
      }

      tips = (tipRows ?? []) as TipRow[];
    }

    const statsByTeam = new Map<
      string,
      {
        tipped_count: number;
        correct_count: number;
        incorrect_count: number;
        total_points: number;
      }
    >();

    for (const team of AFL_TEAMS) {
      statsByTeam.set(team, {
        tipped_count: 0,
        correct_count: 0,
        incorrect_count: 0,
        total_points: 0,
      });
    }

    for (const tip of tips) {
      const matchId = String(tip.match_id);
      const pickedTeam = String(tip.picked_team ?? "").trim();
      if (!pickedTeam) continue;

      const match = scoredMatches.get(matchId);
      if (!match) continue;

      if (!statsByTeam.has(pickedTeam)) {
        statsByTeam.set(pickedTeam, {
          tipped_count: 0,
          correct_count: 0,
          incorrect_count: 0,
          total_points: 0,
        });
      }

      const teamStats = statsByTeam.get(pickedTeam)!;
      teamStats.tipped_count += 1;

      const winnerTeam = String(match.winner_team ?? "").trim();
      const correct = pickedTeam === winnerTeam;
      if (correct) {
        const points = pointsForWinningTip({
          pickedTeam,
          winnerTeam,
          homeTeam: String(match.home_team ?? ""),
          awayTeam: String(match.away_team ?? ""),
          homeOdds: Number(match.home_odds ?? 0),
          awayOdds: Number(match.away_odds ?? 0),
        });
        teamStats.correct_count += 1;
        teamStats.total_points += points;
      } else {
        teamStats.incorrect_count += 1;
      }
    }

    const rows: TeamRow[] = Array.from(statsByTeam.entries())
      .map(([team, value]) => {
        const tipped = Number(value.tipped_count ?? 0);
        const correct = Number(value.correct_count ?? 0);
        const points = Number(value.total_points ?? 0);
        const incorrect = Number(value.incorrect_count ?? 0);
        const accuracy = tipped > 0 ? (correct / tipped) * 100 : 0;
        const avgPerTip = tipped > 0 ? points / tipped : 0;
        const avgPerCorrect = correct > 0 ? points / correct : 0;

        return {
          team,
          tipped_count: tipped,
          correct_count: correct,
          incorrect_count: incorrect,
          accuracy_pct: round1(accuracy),
          total_points: round2(points),
          avg_points_per_tip: round2(avgPerTip),
          avg_points_per_correct: round2(avgPerCorrect),
        };
      })
      .sort((a, b) => {
        if (b.tipped_count !== a.tipped_count) return b.tipped_count - a.tipped_count;
        if (b.total_points !== a.total_points) return b.total_points - a.total_points;
        return a.team.localeCompare(b.team, "en", { sensitivity: "base" });
      });

    const totals = rows.reduce(
      (acc, row) => {
        acc.tipped += row.tipped_count;
        acc.correct += row.correct_count;
        acc.incorrect += row.incorrect_count;
        acc.total_points += row.total_points;
        return acc;
      },
      { tipped: 0, correct: 0, incorrect: 0, total_points: 0 }
    );

    return NextResponse.json({
      ok: true,
      season,
      competition_id: competitionId,
      totals: {
        tipped: totals.tipped,
        correct: totals.correct,
        incorrect: totals.incorrect,
        total_points: round2(totals.total_points),
      },
      rows,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load profile team stats", details },
      { status: 500 }
    );
  }
}

