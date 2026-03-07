import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron } from "@/lib/admin-auth";

const DEFAULT_SEASON = 2026;
const DEFAULT_HOURS_AFTER_FIRST = 48;
const RECAP_TYPE = "end_of_round_v1";

type RoundRow = {
  id: string;
  round_number: number;
  lock_time_utc: string | null;
  odds_snapshot_for_time_utc: string | null;
};

type MatchRow = {
  id: string;
  round_id: string;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  winner_team: string | null;
};

type TipRow = {
  user_id: string;
  match_id: string;
  picked_team: string;
};

type MembershipRow = {
  user_id: string;
};

type MatchOddsRow = {
  match_id: string;
  home_odds: number | null;
  away_odds: number | null;
  captured_at_utc: string;
  snapshot_for_time_utc: string | null;
};

type LeaderboardRow = {
  user_id: string;
  display_name: string;
  rank: number;
  total_points: number;
  round_score: number;
  movement: number;
  previous_rank: number | null;
  behind_leader: number;
  missed_tips: number;
  accuracy_pct: number;
};

type LeaderboardResponse = {
  ok: boolean;
  rows?: LeaderboardRow[];
  error?: string;
};

type RoundResultsMatch = {
  id: string;
  home_team: string;
  away_team: string;
  winner_team: string | null;
  total_tips: number;
  tipping: {
    home_count: number;
    away_count: number;
    home_pct: number;
    away_pct: number;
  };
};

type RoundResultsPlayer = {
  user_id: string;
  display_name: string;
  round_score: number;
  correct_tips: number;
  total_tips: number;
  picks: Record<string, string>;
};

type RoundResultsResponse = {
  ok: boolean;
  matches?: RoundResultsMatch[];
  players?: RoundResultsPlayer[];
  error?: string;
};

type TargetRound = {
  row: RoundRow;
  first_game_utc: string;
  due_at_utc: string;
  match_count: number;
  finished_count: number;
  eligible_now: boolean;
};

type SendResult = {
  status: "sent" | "simulated" | "failed";
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
};

type PlayerRoundStat = {
  user_id: string;
  display_name: string;
  correct_tips: number;
  total_tips: number;
  round_score: number;
  accuracy_pct: number;
  avg_correct_odds: number;
  underdog_points: number;
};

function round2(v: number) {
  return Number(v.toFixed(2));
}

function fmtMelbourne(isoUtc: string | null | undefined) {
  if (!isoUtc) return "n/a";
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return String(isoUtc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function safeDisplayName(name: string | null | undefined, userId: string) {
  const n = String(name ?? "").trim();
  if (n) return n;
  return `${userId.slice(0, 8)}...`;
}

function parseRecipients(raw: string | null | undefined) {
  return String(raw ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function computeTargetRounds(params: {
  rounds: RoundRow[];
  matches: MatchRow[];
  nowMs: number;
  hoursAfterFirst: number;
}) {
  const byRoundId = new Map<string, MatchRow[]>();
  for (const m of params.matches) {
    const rid = String(m.round_id);
    const list = byRoundId.get(rid) ?? [];
    list.push(m);
    byRoundId.set(rid, list);
  }

  const out: TargetRound[] = [];

  for (const r of params.rounds) {
    const list = byRoundId.get(String(r.id)) ?? [];
    const withTimes = list
      .map((m) => ({ ...m, ms: new Date(m.commence_time_utc).getTime() }))
      .filter((m) => Number.isFinite(m.ms));

    if (withTimes.length === 0) continue;

    const firstMs = Math.min(...withTimes.map((m) => m.ms));
    const firstIso = new Date(firstMs).toISOString();
    const dueMs = firstMs + params.hoursAfterFirst * 60 * 60 * 1000;
    const dueIso = new Date(dueMs).toISOString();

    const matchCount = list.length;
    const finishedCount = list.filter((m) => String(m.winner_team ?? "").trim().length > 0).length;

    const eligibleNow = params.nowMs >= dueMs && matchCount > 0 && finishedCount === matchCount;

    out.push({
      row: r,
      first_game_utc: firstIso,
      due_at_utc: dueIso,
      match_count: matchCount,
      finished_count: finishedCount,
      eligible_now: eligibleNow,
    });
  }

  out.sort((a, b) => a.row.round_number - b.row.round_number);
  return out;
}

async function fetchJson<T>(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let data: T | null = null;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw: text };
}

async function sendEmail(params: {
  apiKey: string;
  fromEmail: string;
  replyTo: string | null;
  toEmail: string;
  subject: string;
  text: string;
  html: string;
  dryRun: boolean;
}): Promise<SendResult> {
  if (params.dryRun) {
    return {
      status: "simulated",
      provider: null,
      providerMessageId: null,
      error: null,
    };
  }

  const payload: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
    reply_to?: string;
  } = {
    from: params.fromEmail,
    to: [params.toEmail],
    subject: params.subject,
    text: params.text,
    html: params.html,
  };

  if (params.replyTo) payload.reply_to = params.replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();
  let bodyJson: unknown = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = null;
  }

  if (!res.ok) {
    return {
      status: "failed",
      provider: "resend",
      providerMessageId: null,
      error: `Resend error ${res.status}: ${bodyText.slice(0, 300)}`,
    };
  }

  const providerMessageId =
    typeof bodyJson === "object" &&
    bodyJson !== null &&
    "id" in bodyJson &&
    typeof (bodyJson as { id?: unknown }).id === "string"
      ? (bodyJson as { id: string }).id
      : null;

  return {
    status: "sent",
    provider: "resend",
    providerMessageId,
    error: null,
  };
}

function topN<T>(list: T[], n: number) {
  return list.slice(0, Math.max(0, n));
}

function humanList(parts: string[]) {
  if (parts.length === 0) return "none";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdminOrCron(req);
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || String(DEFAULT_SEASON));
    const roundParam = url.searchParams.get("round");
    const roundFilter = roundParam === null ? null : Number(roundParam);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const force = url.searchParams.get("force") === "1";
    const hoursAfterFirst = Number(
      url.searchParams.get("hours_after_first") || String(DEFAULT_HOURS_AFTER_FIRST)
    );

    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    if (roundFilter !== null && (!Number.isFinite(roundFilter) || roundFilter < 0)) {
      return NextResponse.json({ error: "Provide a valid round" }, { status: 400 });
    }

    if (!Number.isFinite(hoursAfterFirst) || hoursAfterFirst < 0) {
      return NextResponse.json(
        { error: "hours_after_first must be zero or positive" },
        { status: 400 }
      );
    }

    const resendApiKey = process.env.RESEND_API_KEY || "";
    const recapFromEmail = process.env.ROUND_RECAP_FROM_EMAIL || process.env.REMINDER_FROM_EMAIL || "";
    const recapReplyTo =
      process.env.ROUND_RECAP_REPLY_TO || process.env.REMINDER_REPLY_TO || null;
    const recipients = parseRecipients(process.env.ROUND_RECAP_TO_EMAIL);

    if (!dryRun && (!resendApiKey || !recapFromEmail || recipients.length === 0)) {
      return NextResponse.json(
        {
          error: "Missing recap email env vars",
          details:
            "Set RESEND_API_KEY, ROUND_RECAP_FROM_EMAIL (or REMINDER_FROM_EMAIL), and ROUND_RECAP_TO_EMAIL.",
        },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();

    const tableCheck = await supabase.from("round_recap_emails").select("id").limit(1);
    if (tableCheck.error) {
      return NextResponse.json(
        {
          error: "round_recap_emails table missing or inaccessible",
          details: tableCheck.error.message,
          hint: "Apply migration db/migrations/20260308_round_recap_emails.sql",
        },
        { status: 500 }
      );
    }

    const { data: comp, error: cErr } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (cErr || !comp?.id) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    let roundsQuery = supabase
      .from("rounds")
      .select("id, round_number, lock_time_utc, odds_snapshot_for_time_utc")
      .eq("competition_id", comp.id)
      .eq("season", season)
      .order("round_number", { ascending: true });

    if (roundFilter !== null) {
      roundsQuery = roundsQuery.eq("round_number", roundFilter);
    }

    const { data: rounds, error: rErr } = await roundsQuery;
    if (rErr) {
      return NextResponse.json(
        { error: "Failed to read rounds", details: rErr.message },
        { status: 500 }
      );
    }

    const roundRows = (rounds ?? []) as RoundRow[];
    if (roundRows.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        hours_after_first: hoursAfterFirst,
        rounds_considered: 0,
        targeted_round: null,
        sent: 0,
        skipped_reason: "no_rounds",
      });
    }

    const roundIds = roundRows.map((r) => String(r.id));

    const { data: matches, error: mErr } = await supabase
      .from("matches")
      .select("id, round_id, commence_time_utc, home_team, away_team, winner_team")
      .in("round_id", roundIds)
      .order("commence_time_utc", { ascending: true });

    if (mErr) {
      return NextResponse.json(
        { error: "Failed to read matches", details: mErr.message },
        { status: 500 }
      );
    }

    const matchRows = (matches ?? []) as MatchRow[];
    const nowMs = Date.now();

    const candidateRounds = computeTargetRounds({
      rounds: roundRows,
      matches: matchRows,
      nowMs,
      hoursAfterFirst,
    });

    let target: TargetRound | null = null;

    if (roundFilter !== null) {
      target = candidateRounds.find((x) => x.row.round_number === roundFilter) ?? null;
      if (!target) {
        return NextResponse.json({
          ok: true,
          season,
          round: roundFilter,
          hours_after_first: hoursAfterFirst,
          rounds_considered: candidateRounds.length,
          targeted_round: null,
          sent: 0,
          skipped_reason: "round_has_no_matches_or_invalid_times",
        });
      }

      if (!force && !target.eligible_now) {
        return NextResponse.json({
          ok: true,
          season,
          round: target.row.round_number,
          hours_after_first: hoursAfterFirst,
          rounds_considered: candidateRounds.length,
          targeted_round: target.row.round_number,
          sent: 0,
          skipped_reason: "round_not_eligible_yet",
          first_game_utc: target.first_game_utc,
          due_at_utc: target.due_at_utc,
          finished_count: target.finished_count,
          match_count: target.match_count,
        });
      }
    } else {
      const eligible = candidateRounds.filter((x) => x.eligible_now);
      if (eligible.length === 0) {
        return NextResponse.json({
          ok: true,
          season,
          hours_after_first: hoursAfterFirst,
          rounds_considered: candidateRounds.length,
          targeted_round: null,
          sent: 0,
          skipped_reason: "no_eligible_rounds",
        });
      }

      target = eligible[eligible.length - 1] ?? null;
    }

    if (!target) {
      return NextResponse.json({
        ok: true,
        season,
        hours_after_first: hoursAfterFirst,
        rounds_considered: candidateRounds.length,
        targeted_round: null,
        sent: 0,
        skipped_reason: "no_target_round",
      });
    }

    const roundId = String(target.row.id);
    const roundNumber = Number(target.row.round_number);
    const roundMatches = matchRows.filter((m) => String(m.round_id) === roundId);
    const roundMatchIds = roundMatches.map((m) => String(m.id));

    if (roundMatchIds.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        round: roundNumber,
        sent: 0,
        skipped_reason: "target_round_has_no_matches",
      });
    }

    const existingQuery = await supabase
      .from("round_recap_emails")
      .select("recipient_email")
      .eq("competition_id", comp.id)
      .eq("round_id", roundId)
      .eq("recap_type", RECAP_TYPE);

    if (existingQuery.error) {
      return NextResponse.json(
        { error: "Failed checking existing recap sends", details: existingQuery.error.message },
        { status: 500 }
      );
    }

    const alreadySent = new Set<string>(
      ((existingQuery.data ?? []) as Array<{ recipient_email: string }>).map((x) =>
        String(x.recipient_email)
      )
    );

    const recipientsToSend = dryRun
      ? recipients
      : recipients.filter((email) => force || !alreadySent.has(email));

    if (recipientsToSend.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        round: roundNumber,
        hours_after_first: hoursAfterFirst,
        targeted_round: roundNumber,
        sent: 0,
        skipped_reason: "already_sent",
        recipients_total: recipients.length,
        recipients_skipped_existing: recipients.length,
      });
    }

    const { data: memberships, error: memErr } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", comp.id);

    if (memErr) {
      return NextResponse.json(
        { error: "Failed to read memberships", details: memErr.message },
        { status: 500 }
      );
    }

    const members = (memberships ?? []) as MembershipRow[];
    const memberIds = members.map((m) => String(m.user_id));

    const { data: tips, error: tErr } = await supabase
      .from("tips")
      .select("user_id, match_id, picked_team")
      .eq("competition_id", comp.id)
      .in("match_id", roundMatchIds);

    if (tErr) {
      return NextResponse.json(
        { error: "Failed to read tips", details: tErr.message },
        { status: 500 }
      );
    }

    const roundTips = (tips ?? []) as TipRow[];

    const tipUserIds = Array.from(new Set(roundTips.map((t) => String(t.user_id))));
    const profileIds = Array.from(new Set([...memberIds, ...tipUserIds]));

    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", profileIds);

    if (pErr) {
      return NextResponse.json(
        { error: "Failed to read profiles", details: pErr.message },
        { status: 500 }
      );
    }

    const nameByUserId: Record<string, string> = {};
    ((profiles ?? []) as Array<{ id: string; display_name: string | null }>).forEach((p) => {
      const uid = String(p.id);
      nameByUserId[uid] = safeDisplayName(p.display_name, uid);
    });

    const roundResultsUrl = `${url.origin}/api/round-results?season=${encodeURIComponent(
      String(season)
    )}&round=${encodeURIComponent(String(roundNumber))}`;
    const leaderboardUrl = `${url.origin}/api/leaderboard?season=${encodeURIComponent(
      String(season)
    )}`;

    const [roundResultsRes, leaderboardRes] = await Promise.all([
      fetchJson<RoundResultsResponse>(roundResultsUrl),
      fetchJson<LeaderboardResponse>(leaderboardUrl),
    ]);

    if (!roundResultsRes.ok || !roundResultsRes.data?.ok) {
      return NextResponse.json(
        {
          error: "Failed to build recap from round-results",
          details: roundResultsRes.data?.error || roundResultsRes.raw.slice(0, 300),
        },
        { status: 500 }
      );
    }

    if (!leaderboardRes.ok || !leaderboardRes.data?.ok) {
      return NextResponse.json(
        {
          error: "Failed to build recap from leaderboard",
          details: leaderboardRes.data?.error || leaderboardRes.raw.slice(0, 300),
        },
        { status: 500 }
      );
    }

    const rrMatches = (roundResultsRes.data.matches ?? []) as RoundResultsMatch[];
    const rrPlayers = (roundResultsRes.data.players ?? []) as RoundResultsPlayer[];
    const lbRows = ((leaderboardRes.data.rows ?? []) as LeaderboardRow[]).sort(
      (a, b) => Number(a.rank) - Number(b.rank)
    );

    const winnerOddsByMatch: Record<string, number | null> = {};
    const loserOddsByMatch: Record<string, number | null> = {};

    let oddsQuery = supabase
      .from("match_odds")
      .select("match_id, home_odds, away_odds, captured_at_utc, snapshot_for_time_utc")
      .eq("competition_id", comp.id)
      .in("match_id", roundMatchIds)
      .order("captured_at_utc", { ascending: false });

    if (target.row.odds_snapshot_for_time_utc) {
      oddsQuery = oddsQuery.eq("snapshot_for_time_utc", target.row.odds_snapshot_for_time_utc);
    } else {
      oddsQuery = oddsQuery.order("snapshot_for_time_utc", { ascending: false });
    }

    const { data: oddsRows, error: oErr } = await oddsQuery;
    if (oErr) {
      return NextResponse.json(
        { error: "Failed to read odds for recap", details: oErr.message },
        { status: 500 }
      );
    }

    const oddsByMatch: Record<string, { home: number; away: number }> = {};
    for (const row of (oddsRows ?? []) as MatchOddsRow[]) {
      const mid = String(row.match_id);
      if (oddsByMatch[mid]) continue;
      oddsByMatch[mid] = {
        home: Number(row.home_odds ?? 0),
        away: Number(row.away_odds ?? 0),
      };
    }

    const matchById: Record<string, MatchRow> = {};
    roundMatches.forEach((m) => {
      matchById[String(m.id)] = m;
    });

    for (const m of roundMatches) {
      const mid = String(m.id);
      const winner = String(m.winner_team ?? "").trim();
      const odds = oddsByMatch[mid];
      if (!winner || !odds) {
        winnerOddsByMatch[mid] = null;
        loserOddsByMatch[mid] = null;
        continue;
      }
      if (winner === m.home_team) {
        winnerOddsByMatch[mid] = odds.home;
        loserOddsByMatch[mid] = odds.away;
      } else if (winner === m.away_team) {
        winnerOddsByMatch[mid] = odds.away;
        loserOddsByMatch[mid] = odds.home;
      } else {
        winnerOddsByMatch[mid] = null;
        loserOddsByMatch[mid] = null;
      }
    }

    const picksByUserMatch = new Map<string, Map<string, string>>();
    for (const t of roundTips) {
      const uid = String(t.user_id);
      if (!picksByUserMatch.has(uid)) picksByUserMatch.set(uid, new Map<string, string>());
      picksByUserMatch.get(uid)!.set(String(t.match_id), String(t.picked_team ?? ""));
    }

    const roundTipCountByTeam: Record<string, number> = {};
    for (const t of roundTips) {
      const team = String(t.picked_team ?? "").trim();
      if (!team) continue;
      roundTipCountByTeam[team] = (roundTipCountByTeam[team] ?? 0) + 1;
    }

    const playerStats: PlayerRoundStat[] = rrPlayers.map((p) => {
      let correctOddsSum = 0;
      let underdogPoints = 0;

      for (const m of roundMatches) {
        const mid = String(m.id);
        const winner = String(m.winner_team ?? "").trim();
        if (!winner) continue;

        const picked = p.picks?.[mid] ?? null;
        if (!picked || picked !== winner) continue;

        const winnerOdds = winnerOddsByMatch[mid] ?? null;
        const loserOdds = loserOddsByMatch[mid] ?? null;
        if (winnerOdds !== null) correctOddsSum += Number(winnerOdds);
        if (
          winnerOdds !== null &&
          loserOdds !== null &&
          Number(winnerOdds) > Number(loserOdds)
        ) {
          underdogPoints += Number(winnerOdds);
        }
      }

      const accuracy = p.total_tips > 0 ? (p.correct_tips / p.total_tips) * 100 : 0;
      const avgCorrectOdds = p.correct_tips > 0 ? correctOddsSum / p.correct_tips : 0;

      return {
        user_id: p.user_id,
        display_name: p.display_name,
        correct_tips: Number(p.correct_tips ?? 0),
        total_tips: Number(p.total_tips ?? 0),
        round_score: Number(p.round_score ?? 0),
        accuracy_pct: accuracy,
        avg_correct_odds: avgCorrectOdds,
        underdog_points: underdogPoints,
      };
    });

    const tipsPlaced = playerStats.reduce((sum, p) => sum + p.total_tips, 0);
    const correctPlaced = playerStats.reduce((sum, p) => sum + p.correct_tips, 0);
    const roundDifficultyPct = tipsPlaced > 0 ? (correctPlaced / tipsPlaced) * 100 : 0;

    const maxRoundScore = playerStats.length
      ? Math.max(...playerStats.map((p) => Number(p.round_score)))
      : 0;
    const roundWinners = playerStats.filter((p) => Number(p.round_score) === maxRoundScore);

    const roundAvg =
      playerStats.length > 0
        ? playerStats.reduce((sum, p) => sum + Number(p.round_score), 0) / playerStats.length
        : 0;

    const perfectTips = rrMatches.length;
    const closestToPerfect = [...playerStats]
      .sort((a, b) => {
        if (b.correct_tips !== a.correct_tips) return b.correct_tips - a.correct_tips;
        return b.round_score - a.round_score;
      })
      .filter((p) => p.correct_tips < perfectTips);

    const tippedUsers = new Set<string>();
    roundTips.forEach((t) => tippedUsers.add(String(t.user_id)));
    const tippedCount = tippedUsers.size;
    const totalMembers = memberIds.length;
    const missingCount = Math.max(0, totalMembers - tippedCount);

    const mostPickedTeam = Object.entries(roundTipCountByTeam)
      .sort((a, b) => b[1] - a[1])[0] ?? null;

    const closestSplit = [...rrMatches]
      .filter((m) => Number(m.total_tips ?? 0) > 0)
      .map((m) => {
        const diff = Math.abs(Number(m.tipping.home_pct) - Number(m.tipping.away_pct));
        return { match: m, diff };
      })
      .sort((a, b) => a.diff - b.diff)[0] ?? null;

    const consensusMiss = [...rrMatches]
      .filter((m) => String(m.winner_team ?? "").trim().length > 0 && Number(m.total_tips ?? 0) > 0)
      .map((m) => {
        const winner = String(m.winner_team ?? "");
        const loser = winner === m.home_team ? m.away_team : m.home_team;
        const loserCount =
          loser === m.home_team ? Number(m.tipping.home_count) : Number(m.tipping.away_count);
        const loserPct = Number(m.total_tips ?? 0) > 0 ? (loserCount / Number(m.total_tips)) * 100 : 0;
        return { match: m, loser, loserCount, loserPct };
      })
      .sort((a, b) => b.loserPct - a.loserPct)[0] ?? null;

    let biggestUpset:
      | { match: MatchRow; winner: string; winnerOdds: number; loserOdds: number }
      | null = null;
    let underdogPointsAwarded = 0;
    const underdogWinningMatchIds = new Set<string>();

    for (const m of roundMatches) {
      const mid = String(m.id);
      const winner = String(m.winner_team ?? "").trim();
      if (!winner) continue;

      const winnerOdds = winnerOddsByMatch[mid];
      const loserOdds = loserOddsByMatch[mid];
      if (winnerOdds === null || loserOdds === null) continue;

      const winnerCount = roundTips.filter(
        (t) => String(t.match_id) === mid && String(t.picked_team) === winner
      ).length;

      if (Number(winnerOdds) > Number(loserOdds)) {
        underdogWinningMatchIds.add(mid);
        underdogPointsAwarded += Number(winnerOdds) * winnerCount;
      }

      if (
        !biggestUpset ||
        Number(winnerOdds) > Number(biggestUpset.winnerOdds)
      ) {
        biggestUpset = {
          match: m,
          winner,
          winnerOdds: Number(winnerOdds),
          loserOdds: Number(loserOdds),
        };
      }
    }

    const clutchPick = [...rrMatches]
      .filter((m) => String(m.winner_team ?? "").trim().length > 0 && Number(m.total_tips ?? 0) > 0)
      .map((m) => {
        const winner = String(m.winner_team ?? "");
        const winnerCount =
          winner === m.home_team ? Number(m.tipping.home_count) : Number(m.tipping.away_count);
        const winnerShare = Number(m.total_tips ?? 0) > 0 ? (winnerCount / Number(m.total_tips)) * 100 : 0;
        const winnerOdds = winnerOddsByMatch[m.id] ?? null;
        return { match: m, winner, winnerShare, winnerCount, winnerOdds };
      })
      .filter((x) => x.winnerOdds !== null && x.winnerCount > 0)
      .sort((a, b) => {
        if (a.winnerShare !== b.winnerShare) return a.winnerShare - b.winnerShare;
        return Number(b.winnerOdds) - Number(a.winnerOdds);
      })[0] ?? null;

    const topRises = topN(
      [...lbRows].filter((r) => Number(r.movement) > 0).sort((a, b) => Number(b.movement) - Number(a.movement)),
      3
    );
    const topDrops = topN(
      [...lbRows].filter((r) => Number(r.movement) < 0).sort((a, b) => Number(a.movement) - Number(b.movement)),
      3
    );

    const podiumEntered = lbRows.filter(
      (r) => Number(r.rank) <= 3 && (r.previous_rank === null || Number(r.previous_rank) > 3)
    );
    const podiumExited = lbRows.filter(
      (r) => Number(r.rank) > 3 && r.previous_rank !== null && Number(r.previous_rank) <= 3
    );

    const highestVolatility =
      [...lbRows]
        .sort((a, b) => Math.abs(Number(b.movement)) - Math.abs(Number(a.movement)))[0] ?? null;

    const closestRivalPairs: Array<{ a: LeaderboardRow; b: LeaderboardRow; gap: number }> = [];
    for (let i = 0; i < lbRows.length - 1; i += 1) {
      const a = lbRows[i];
      const b = lbRows[i + 1];
      const gap = Math.abs(Number(a.total_points) - Number(b.total_points));
      closestRivalPairs.push({ a, b, gap });
    }
    closestRivalPairs.sort((x, y) => x.gap - y.gap);

    const leader = lbRows.find((r) => Number(r.rank) === 1) ?? lbRows[0] ?? null;
    const second = lbRows.find((r) => Number(r.rank) === 2) ?? null;
    const leaderMargin = second ? Number(second.behind_leader ?? 0) : 0;

    const seasonRoundsById = new Map<string, RoundRow>();
    roundRows.forEach((r) => seasonRoundsById.set(String(r.id), r));

    const beforeRoundMatchIds = matchRows
      .filter((m) => {
        const rr = seasonRoundsById.get(String(m.round_id));
        return !!rr && Number(rr.round_number) < roundNumber;
      })
      .map((m) => String(m.id));

    const beforeRoundTipsByTeam: Record<string, number> = {};
    let beforeRoundTipsTotal = 0;
    if (beforeRoundMatchIds.length > 0) {
      const { data: beforeTips, error: btErr } = await supabase
        .from("tips")
        .select("picked_team")
        .eq("competition_id", comp.id)
        .in("match_id", beforeRoundMatchIds);

      if (!btErr) {
        ((beforeTips ?? []) as Array<{ picked_team: string }>).forEach((t) => {
          const team = String(t.picked_team ?? "").trim();
          if (!team) return;
          beforeRoundTipsByTeam[team] = (beforeRoundTipsByTeam[team] ?? 0) + 1;
          beforeRoundTipsTotal += 1;
        });
      }
    }

    const roundTipsTotal = Object.values(roundTipCountByTeam).reduce((s, n) => s + Number(n), 0);
    const sentimentRows = Array.from(
      new Set([...Object.keys(roundTipCountByTeam), ...Object.keys(beforeRoundTipsByTeam)])
    )
      .map((team) => {
        const roundShare = roundTipsTotal > 0 ? (Number(roundTipCountByTeam[team] ?? 0) / roundTipsTotal) * 100 : 0;
        const seasonShare =
          beforeRoundTipsTotal > 0
            ? (Number(beforeRoundTipsByTeam[team] ?? 0) / beforeRoundTipsTotal) * 100
            : 0;
        return {
          team,
          round_share: roundShare,
          season_share: seasonShare,
          delta: roundShare - seasonShare,
        };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const scoredMatchesUpTo = matchRows
      .filter((m) => {
        const rr = seasonRoundsById.get(String(m.round_id));
        if (!rr) return false;
        if (Number(rr.round_number) > roundNumber) return false;
        return String(m.winner_team ?? "").trim().length > 0;
      })
      .sort((a, b) => a.commence_time_utc.localeCompare(b.commence_time_utc));

    const scoredMatchIdsUpTo = scoredMatchesUpTo.map((m) => String(m.id));

    const allTipsUpToByUser = new Map<string, Map<string, string>>();
    if (scoredMatchIdsUpTo.length > 0) {
      const { data: upTips, error: upTErr } = await supabase
        .from("tips")
        .select("user_id, match_id, picked_team")
        .eq("competition_id", comp.id)
        .in("match_id", scoredMatchIdsUpTo);

      if (!upTErr) {
        ((upTips ?? []) as TipRow[]).forEach((t) => {
          const uid = String(t.user_id);
          if (!allTipsUpToByUser.has(uid)) allTipsUpToByUser.set(uid, new Map<string, string>());
          allTipsUpToByUser.get(uid)!.set(String(t.match_id), String(t.picked_team ?? ""));
        });
      }
    }

    const scoredBeforeRound = scoredMatchesUpTo.filter((m) => {
      const rr = seasonRoundsById.get(String(m.round_id));
      return !!rr && Number(rr.round_number) < roundNumber;
    });

    function computeStreak(matchesOrdered: MatchRow[], picks: Map<string, string> | undefined) {
      if (!picks || matchesOrdered.length === 0) return 0;
      let streak = 0;
      for (let i = matchesOrdered.length - 1; i >= 0; i -= 1) {
        const m = matchesOrdered[i];
        const winner = String(m.winner_team ?? "").trim();
        const picked = String(picks.get(String(m.id)) ?? "").trim();
        if (!winner || !picked || picked !== winner) break;
        streak += 1;
      }
      return streak;
    }

    const streakRows = memberIds.map((uid) => {
      const picks = allTipsUpToByUser.get(uid);
      const pre = computeStreak(scoredBeforeRound, picks);
      const post = computeStreak(scoredMatchesUpTo, picks);
      return {
        user_id: uid,
        display_name: safeDisplayName(nameByUserId[uid], uid),
        pre_streak: pre,
        post_streak: post,
      };
    });

    const longestCurrentStreak = [...streakRows].sort((a, b) => b.post_streak - a.post_streak)[0] ?? null;
    const brokenStreaks = streakRows
      .filter((x) => x.pre_streak >= 3 && x.post_streak < x.pre_streak)
      .sort((a, b) => b.pre_streak - a.pre_streak);

    const highRisk = [...playerStats]
      .filter((p) => p.correct_tips >= 2)
      .sort((a, b) => b.avg_correct_odds - a.avg_correct_odds)[0] ?? null;

    const efficient = [...playerStats]
      .filter((p) => p.total_tips >= 3)
      .sort((a, b) => {
        if (b.accuracy_pct !== a.accuracy_pct) return b.accuracy_pct - a.accuracy_pct;
        return b.round_score - a.round_score;
      })[0] ?? null;

    const sharpPickLeaders = topN(
      [...playerStats]
        .filter((p) => p.underdog_points > 0)
        .sort((a, b) => b.underdog_points - a.underdog_points),
      3
    );

    const whatIfRows = memberIds
      .map((uid) => {
        const picks = picksByUserMatch.get(uid);
        let potentialGain = 0;
        let missingTips = 0;

        for (const m of roundMatches) {
          const mid = String(m.id);
          const winnerOdds = winnerOddsByMatch[mid] ?? null;
          if (!winnerOdds) continue;

          const picked = picks?.get(mid) ?? null;
          if (!picked) {
            missingTips += 1;
            potentialGain += Number(winnerOdds);
          }
        }

        return {
          user_id: uid,
          display_name: safeDisplayName(nameByUserId[uid], uid),
          missing_tips: missingTips,
          potential_gain: potentialGain,
        };
      })
      .filter((r) => r.missing_tips > 0 && r.potential_gain > 0)
      .sort((a, b) => b.potential_gain - a.potential_gain);

    const nextRound = roundRows.find((r) => Number(r.round_number) === roundNumber + 1) ?? null;
    let nextRoundLock = "n/a";
    let nextRoundUpsets: Array<{ home: string; away: string; gap: number }> = [];

    if (nextRound) {
      const nextMatches = matchRows.filter((m) => String(m.round_id) === String(nextRound.id));
      if (nextMatches.length > 0) {
        const firstMs = Math.min(
          ...nextMatches
            .map((m) => new Date(m.commence_time_utc).getTime())
            .filter((ms) => Number.isFinite(ms))
        );
        if (Number.isFinite(firstMs)) {
          nextRoundLock = fmtMelbourne(new Date(firstMs).toISOString());
        }

        const nextIds = nextMatches.map((m) => String(m.id));
        const { data: nextOddsRows } = await supabase
          .from("match_odds")
          .select("match_id, home_odds, away_odds, captured_at_utc")
          .eq("competition_id", comp.id)
          .in("match_id", nextIds)
          .order("captured_at_utc", { ascending: false });

        const latestOddsByMatch: Record<string, { home: number; away: number }> = {};
        ((nextOddsRows ?? []) as Array<{ match_id: string; home_odds: number; away_odds: number }>).forEach((r) => {
          const mid = String(r.match_id);
          if (latestOddsByMatch[mid]) return;
          latestOddsByMatch[mid] = {
            home: Number(r.home_odds ?? 0),
            away: Number(r.away_odds ?? 0),
          };
        });

        nextRoundUpsets = nextMatches
          .map((m) => {
            const o = latestOddsByMatch[String(m.id)];
            if (!o) return null;
            return {
              home: m.home_team,
              away: m.away_team,
              gap: Math.abs(Number(o.home) - Number(o.away)),
            };
          })
          .filter((x): x is { home: string; away: string; gap: number } => !!x)
          .sort((a, b) => a.gap - b.gap)
          .slice(0, 3);
      }
    }

    const headlineBits: string[] = [];
    if (roundWinners.length > 0) {
      headlineBits.push(
        `Round winner: ${humanList(roundWinners.map((w) => w.display_name))} (${round2(maxRoundScore)} pts)`
      );
    }
    if (topRises.length > 0) {
      headlineBits.push(
        `Biggest rise: ${topRises[0].display_name} (+${topRises[0].movement})`
      );
    }
    if (topDrops.length > 0) {
      headlineBits.push(
        `Biggest drop: ${topDrops[0].display_name} (${topDrops[0].movement})`
      );
    }
    if (biggestUpset) {
      headlineBits.push(
        `Biggest upset: ${biggestUpset.winner} at ${round2(biggestUpset.winnerOdds)}`
      );
    }
    headlineBits.push(`Round difficulty: ${round2(roundDifficultyPct)}% correct`);

    const subject = `Round ${roundNumber} recap (${season})`;

    const textLines: string[] = [];
    textLines.push(`Needlessly Complicated Tipping - Round ${roundNumber} Recap`);
    textLines.push("");
    textLines.push(`Generated: ${fmtMelbourne(new Date().toISOString())} (Melbourne)`);
    textLines.push(`First game: ${fmtMelbourne(target.first_game_utc)}`);
    textLines.push(`Eligible after ${hoursAfterFirst}h: ${fmtMelbourne(target.due_at_utc)}`);
    textLines.push("");

    textLines.push("Top headlines");
    headlineBits.forEach((h) => textLines.push(`- ${h}`));
    textLines.push("");

    textLines.push("Round outcomes");
    textLines.push(`- Average round score: ${round2(roundAvg)}`);
    textLines.push(
      `- Closest to perfect: ${closestToPerfect[0] ? `${closestToPerfect[0].display_name} (${closestToPerfect[0].correct_tips}/${perfectTips})` : "n/a"}`
    );
    textLines.push(
      `- Participation: ${tippedCount}/${totalMembers} tipped, ${missingCount} missed`
    );
    textLines.push("");

    textLines.push("Ladder movement");
    textLines.push(
      `- Top rises: ${topRises.length ? topRises.map((r) => `${r.display_name} (+${r.movement})`).join(", ") : "none"}`
    );
    textLines.push(
      `- Top drops: ${topDrops.length ? topDrops.map((r) => `${r.display_name} (${r.movement})`).join(", ") : "none"}`
    );
    textLines.push(
      `- Podium entered: ${podiumEntered.length ? podiumEntered.map((r) => r.display_name).join(", ") : "none"}`
    );
    textLines.push(
      `- Podium exited: ${podiumExited.length ? podiumExited.map((r) => r.display_name).join(", ") : "none"}`
    );
    textLines.push(`- Leader margin: ${round2(leaderMargin)} pts`);
    textLines.push(
      `- Highest volatility: ${highestVolatility ? `${highestVolatility.display_name} (${highestVolatility.movement > 0 ? "+" : ""}${highestVolatility.movement})` : "n/a"}`
    );
    textLines.push("");

    textLines.push("Rival gaps");
    textLines.push(
      `- Closest rivals: ${closestRivalPairs.length ? topN(closestRivalPairs, 3).map((p) => `${p.a.display_name} vs ${p.b.display_name} (${round2(p.gap)} pts)`).join(", ") : "n/a"}`
    );
    textLines.push("");

    textLines.push("Pick trends");
    textLines.push(
      `- Most-picked team: ${mostPickedTeam ? `${mostPickedTeam[0]} (${mostPickedTeam[1]} picks)` : "n/a"}`
    );
    textLines.push(
      `- Closest split: ${closestSplit ? `${closestSplit.match.home_team} vs ${closestSplit.match.away_team} (${closestSplit.diff.toFixed(1)}% spread)` : "n/a"}`
    );
    textLines.push(
      `- Consensus miss: ${consensusMiss ? `${consensusMiss.match.home_team} vs ${consensusMiss.match.away_team} (${consensusMiss.loser} tipped by ${round2(consensusMiss.loserPct)}%)` : "n/a"}`
    );
    textLines.push("");

    textLines.push("Upsets and sharp picks");
    textLines.push(
      `- Biggest upset: ${biggestUpset ? `${biggestUpset.winner} won at ${round2(biggestUpset.winnerOdds)} (${biggestUpset.match.home_team} vs ${biggestUpset.match.away_team})` : "n/a"}`
    );
    textLines.push(`- Underdog points awarded: ${round2(underdogPointsAwarded)}`);
    textLines.push(
      `- Clutch pick: ${clutchPick ? `${clutchPick.winner} picked by ${round2(clutchPick.winnerShare)}%` : "n/a"}`
    );
    textLines.push(
      `- Sharp pick leaders: ${sharpPickLeaders.length ? sharpPickLeaders.map((p) => `${p.display_name} (${round2(p.underdog_points)} pts from underdogs)`).join(", ") : "none"}`
    );
    textLines.push("");

    textLines.push("Luck vs skill");
    textLines.push(
      `- Risk profile: ${highRisk ? `${highRisk.display_name} (avg correct odds ${round2(highRisk.avg_correct_odds)})` : "n/a"}`
    );
    textLines.push(
      `- Efficiency profile: ${efficient ? `${efficient.display_name} (${round2(efficient.accuracy_pct)}% accuracy)` : "n/a"}`
    );
    textLines.push("");

    textLines.push("Streak watch");
    textLines.push(
      `- Longest current streak: ${longestCurrentStreak ? `${longestCurrentStreak.display_name} (${longestCurrentStreak.post_streak})` : "n/a"}`
    );
    textLines.push(
      `- Broken streaks: ${brokenStreaks.length ? brokenStreaks.slice(0, 3).map((s) => `${s.display_name} (${s.pre_streak} -> ${s.post_streak})`).join(", ") : "none"}`
    );
    textLines.push("");

    textLines.push("Team sentiment heat");
    textLines.push(
      `- Biggest shifts vs season baseline: ${sentimentRows.length ? topN(sentimentRows, 3).map((s) => `${s.team} (${s.delta >= 0 ? "+" : ""}${round2(s.delta)}pp)`).join(", ") : "n/a"}`
    );
    textLines.push("");

    textLines.push("What-if scenarios");
    textLines.push(
      `- Missed-tip max swing: ${whatIfRows.length ? topN(whatIfRows, 2).map((r) => `${r.display_name} (+${round2(r.potential_gain)} max)`).join(", ") : "n/a"}`
    );
    textLines.push("");

    textLines.push("Next round forecast");
    textLines.push(
      `- Next round lock: ${nextRound ? nextRoundLock : "n/a"}`
    );
    textLines.push(
      `- Closest odds matchups: ${nextRoundUpsets.length ? nextRoundUpsets.map((m) => `${m.home} vs ${m.away} (gap ${round2(m.gap)})`).join(", ") : "n/a"}`
    );

    const text = textLines.join("\n");
    const html = `<div style=\"font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111;white-space:pre-wrap\">${text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</div>`;

    const payloadForLog = {
      season,
      round: roundNumber,
      first_game_utc: target.first_game_utc,
      due_at_utc: target.due_at_utc,
      summary: {
        max_round_score: round2(maxRoundScore),
        avg_round_score: round2(roundAvg),
        tipped_count: tippedCount,
        total_members: totalMembers,
        missing_count: missingCount,
        round_difficulty_pct: round2(roundDifficultyPct),
      },
      headline_bits: headlineBits,
    };

    let sent = 0;
    let simulated = 0;
    let failed = 0;
    const results: Array<{ to: string; status: string; error?: string | null }> = [];

    for (const toEmail of recipientsToSend) {
      const sendRes = await sendEmail({
        apiKey: resendApiKey,
        fromEmail: recapFromEmail,
        replyTo: recapReplyTo,
        toEmail,
        subject,
        text,
        html,
        dryRun,
      });

      results.push({ to: toEmail, status: sendRes.status, error: sendRes.error });

      if (sendRes.status === "sent") {
        sent += 1;

        const { error: logErr } = await supabase.from("round_recap_emails").upsert(
          {
            competition_id: comp.id,
            round_id: roundId,
            season,
            round_number: roundNumber,
            recap_type: RECAP_TYPE,
            recipient_email: toEmail,
            provider: sendRes.provider,
            provider_message_id: sendRes.providerMessageId,
            payload_json: payloadForLog,
          },
          {
            onConflict: "competition_id,round_id,recap_type,recipient_email",
          }
        );

        if (logErr) {
          failed += 1;
          sent = Math.max(0, sent - 1);
          results.push({
            to: toEmail,
            status: "failed",
            error: `Sent but failed logging: ${logErr.message}`,
          });
        }
      } else if (sendRes.status === "simulated") {
        simulated += 1;
      } else {
        failed += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      season,
      round: roundNumber,
      recap_type: RECAP_TYPE,
      hours_after_first: hoursAfterFirst,
      targeted_round: roundNumber,
      first_game_utc: target.first_game_utc,
      due_at_utc: target.due_at_utc,
      dry_run: dryRun,
      totals: {
        recipients_total: recipients.length,
        recipients_targeted: recipientsToSend.length,
        sent,
        simulated,
        failed,
        skipped_existing: recipients.length - recipientsToSend.length,
      },
      results,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Unexpected error", details },
      { status: 500 }
    );
  }
}
