import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

type MatchRow = {
  id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  venue: string | null;
  status: string | null;
  winner_team: string | null;
};

type TipRow = {
  user_id: string;
  match_id: string;
  picked_team: string;
};

type OddsRow = {
  match_id: string;
  home_odds: number;
  away_odds: number;
  captured_at_utc: string;
  snapshot_for_time_utc: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

function safeDisplayName(name: string | null | undefined) {
  const n = String(name ?? "").trim();
  return n || "(no display name)";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season"));
    const round = Number(url.searchParams.get("round"));

    if (!Number.isFinite(season) || !Number.isFinite(round) || round < 0) {
      return NextResponse.json(
        { ok: false, error: "Provide valid season and round" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data: comp, error: cErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (cErr || !comp?.id) {
      return NextResponse.json({ ok: false, error: "No competition found" }, { status: 404 });
    }

    const { data: roundRow, error: rErr } = await supabase
      .from("rounds")
      .select("id, lock_time_utc, odds_snapshot_for_time_utc")
      .eq("competition_id", comp.id)
      .eq("season", season)
      .eq("round_number", round)
      .single();

    if (rErr || !roundRow?.id) {
      return NextResponse.json({ ok: false, error: "Round not found" }, { status: 404 });
    }

    const roundId = String(roundRow.id);
    const snapshotForTimeUtc = roundRow.odds_snapshot_for_time_utc ?? null;

    const { data: matches, error: mErr } = await supabase
      .from("matches")
      .select("id, commence_time_utc, home_team, away_team, venue, status, winner_team")
      .eq("round_id", roundId)
      .order("commence_time_utc", { ascending: true });

    if (mErr) {
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
    }

    const matchList = (matches ?? []) as MatchRow[];
    const matchIds = matchList.map((m) => String(m.id));

    if (!matchIds.length) {
      return NextResponse.json({
        ok: true,
        season,
        round,
        round_id: roundId,
        lock_time_utc: roundRow.lock_time_utc,
        snapshot_for_time_utc: snapshotForTimeUtc,
        matches: [],
        players: [],
        top_score: 0,
        top_scorers: [],
      });
    }

    const { data: tips, error: tErr } = await supabase
      .from("tips")
      .select("user_id, match_id, picked_team")
      .eq("competition_id", comp.id)
      .in("match_id", matchIds);

    if (tErr) {
      return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 });
    }

    const tipRows = (tips ?? []) as TipRow[];

    const userIds = Array.from(new Set(tipRows.map((t) => String(t.user_id))));

    const nameByUserId: Record<string, string> = {};
    if (userIds.length) {
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);

      if (pErr) {
        return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
      }

      (profiles as ProfileRow[] | null)?.forEach((p) => {
        nameByUserId[String(p.id)] = safeDisplayName(p.display_name);
      });
    }

    let oddsQuery = supabase
      .from("match_odds")
      .select("match_id, home_odds, away_odds, captured_at_utc, snapshot_for_time_utc")
      .eq("competition_id", comp.id)
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
    (oddsRows as OddsRow[] | null)?.forEach((row) => {
      const mid = String(row.match_id);
      if (!oddsByMatchId[mid]) {
        oddsByMatchId[mid] = {
          home_odds: Number(row.home_odds ?? 0),
          away_odds: Number(row.away_odds ?? 0),
        };
      }
    });

    const teamCountByMatch: Record<string, Record<string, number>> = {};
    const tipsByMatch: Record<
      string,
      Array<{ user_id: string; display_name: string; picked_team: string; is_correct: boolean | null; points: number }>
    > = {};

    const playersById: Record<
      string,
      {
        user_id: string;
        display_name: string;
        round_score: number;
        correct_tips: number;
        total_tips: number;
        picks: Record<string, string>;
      }
    > = {};

    const matchById: Record<string, MatchRow> = {};
    for (const m of matchList) matchById[m.id] = m;

    for (const t of tipRows) {
      const uid = String(t.user_id);
      const mid = String(t.match_id);
      const pickedTeam = String(t.picked_team ?? "").trim();
      if (!pickedTeam || !matchById[mid]) continue;

      const m = matchById[mid];
      const winner = String(m.winner_team ?? "").trim();
      const isFinished = !!winner;

      if (!teamCountByMatch[mid]) teamCountByMatch[mid] = {};
      teamCountByMatch[mid][pickedTeam] = (teamCountByMatch[mid][pickedTeam] ?? 0) + 1;

      const odds = oddsByMatchId[mid];
      let points = 0;
      let isCorrect: boolean | null = null;

      if (isFinished) {
        isCorrect = pickedTeam === winner;
        if (isCorrect && odds) {
          if (winner === m.home_team) points = Number(odds.home_odds ?? 0);
          else if (winner === m.away_team) points = Number(odds.away_odds ?? 0);
        }
      }

      if (!tipsByMatch[mid]) tipsByMatch[mid] = [];
      tipsByMatch[mid].push({
        user_id: uid,
        display_name: nameByUserId[uid] ?? "Anonymous tipster",
        picked_team: pickedTeam,
        is_correct: isCorrect,
        points,
      });

      if (!playersById[uid]) {
        playersById[uid] = {
          user_id: uid,
          display_name: nameByUserId[uid] ?? "Anonymous tipster",
          round_score: 0,
          correct_tips: 0,
          total_tips: 0,
          picks: {},
        };
      }

      playersById[uid].total_tips += 1;
      playersById[uid].picks[mid] = pickedTeam;

      if (isCorrect) {
        playersById[uid].correct_tips += 1;
        playersById[uid].round_score += points;
      }
    }

    const matchesOut = matchList.map((m) => {
      const mid = m.id;
      const totalTips = (tipsByMatch[mid] ?? []).length;
      const byTeam = teamCountByMatch[mid] ?? {};
      const homeCount = byTeam[m.home_team] ?? 0;
      const awayCount = byTeam[m.away_team] ?? 0;
      const homePct = totalTips ? Math.round((homeCount / totalTips) * 100) : 0;
      const awayPct = totalTips ? Math.round((awayCount / totalTips) * 100) : 0;

      const tippedBy = [...(tipsByMatch[mid] ?? [])].sort((a, b) =>
        a.display_name.localeCompare(b.display_name)
      );

      return {
        ...m,
        total_tips: totalTips,
        tipping: {
          home_team: m.home_team,
          away_team: m.away_team,
          home_count: homeCount,
          away_count: awayCount,
          home_pct: homePct,
          away_pct: awayPct,
        },
        tipped_by: tippedBy,
      };
    });

    const players = Object.values(playersById).sort((a, b) => {
      if (b.round_score !== a.round_score) return b.round_score - a.round_score;
      if (b.correct_tips !== a.correct_tips) return b.correct_tips - a.correct_tips;
      return a.display_name.localeCompare(b.display_name);
    });

    const topScore = players.length ? players[0].round_score : 0;
    const topScorers = players.filter((p) => p.round_score === topScore && topScore > 0);

    return NextResponse.json({
      ok: true,
      season,
      round,
      round_id: roundId,
      lock_time_utc: roundRow.lock_time_utc,
      snapshot_for_time_utc: snapshotForTimeUtc,
      matches: matchesOut,
      players,
      top_score: topScore,
      top_scorers: topScorers,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
