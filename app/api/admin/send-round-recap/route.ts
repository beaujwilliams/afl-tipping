import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getDefaultCompetitionId, requireAdminOrCron } from "@/lib/admin-auth";

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
  rank_trends?: Array<{
    user_id: string;
    display_name: string;
    points: Array<{
      round_number: number;
      rank: number;
      total_points: number;
    }>;
  }>;
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

type RoundAggregateStat = {
  round_number: number;
  difficulty_pct: number;
  average_score: number;
  majority_wins: number;
  game_count: number;
  minority_winner_count: number;
  most_picked_team: string | null;
  most_picked_count: number;
  most_picked_pct: number;
};

function round2(v: number) {
  return Number(v.toFixed(2));
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

function isLikelyEmail(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalizeRecipientEmails(list: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const email = String(raw ?? "").trim().toLowerCase();
    if (!isLikelyEmail(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
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

function fmtSigned(n: number) {
  const raw = Number(n) || 0;
  const rounded = round2(raw);
  const label =
    Math.abs(rounded - Math.trunc(rounded)) < 0.0001
      ? String(Math.trunc(rounded))
      : rounded.toFixed(2);
  return rounded > 0 ? `+${label}` : label;
}

function fmt2(n: number) {
  return round2(Number(n) || 0).toFixed(2);
}

function fmt1(n: number) {
  return (Math.round((Number(n) || 0) * 10) / 10).toFixed(1);
}

function ordinal(n: number) {
  const v = Math.trunc(Number(n) || 0);
  const mod100 = Math.abs(v) % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  const mod10 = Math.abs(v) % 10;
  if (mod10 === 1) return `${v}st`;
  if (mod10 === 2) return `${v}nd`;
  if (mod10 === 3) return `${v}rd`;
  return `${v}th`;
}

function atHandle(name: string) {
  const n = String(name ?? "").trim();
  if (!n) return "@unknown";
  return n.startsWith("@") ? n : `@${n}`;
}

function pickByRound<T>(round: number, options: T[]) {
  if (options.length === 0) throw new Error("pickByRound requires at least one option");
  const idx = Math.abs(Math.trunc(round)) % options.length;
  return options[idx];
}

function computeDifficultyPct(
  players: Array<{ correct_tips: number; total_tips: number }>
) {
  const tipsPlaced = players.reduce((sum, p) => sum + Number(p.total_tips ?? 0), 0);
  const correctPlaced = players.reduce((sum, p) => sum + Number(p.correct_tips ?? 0), 0);
  return tipsPlaced > 0 ? (correctPlaced / tipsPlaced) * 100 : 0;
}

function computeRoundAverage(players: Array<{ round_score: number }>) {
  if (players.length === 0) return 0;
  return (
    players.reduce((sum, p) => sum + Number(p.round_score ?? 0), 0) / players.length
  );
}

function summarizeRoundAggregateStat(params: {
  roundNumber: number;
  matches: RoundResultsMatch[];
  players: Array<{ correct_tips: number; total_tips: number; round_score: number }>;
}): RoundAggregateStat {
  const { roundNumber, matches, players } = params;
  const difficultyPct = computeDifficultyPct(players);
  const averageScore = computeRoundAverage(players);

  let majorityWins = 0;
  const minorityBackedWinners: Array<{ winner: string; winnerPct: number }> = [];
  const teamPickCounts: Record<string, number> = {};

  for (const m of matches) {
    const winner = String(m.winner_team ?? "").trim();
    if (!winner) continue;

    const homeCount = Number(m.tipping.home_count ?? 0);
    const awayCount = Number(m.tipping.away_count ?? 0);
    const totalTips = Number(m.total_tips ?? 0);

    const majorityTeam = homeCount >= awayCount ? m.home_team : m.away_team;
    if (winner === majorityTeam) majorityWins += 1;

    const winnerCount = winner === m.home_team ? homeCount : winner === m.away_team ? awayCount : 0;
    const winnerPct = totalTips > 0 ? (winnerCount / totalTips) * 100 : 0;
    if (winnerPct < 50) minorityBackedWinners.push({ winner, winnerPct });

    const homeTeam = String(m.home_team ?? "").trim();
    const awayTeam = String(m.away_team ?? "").trim();
    if (homeTeam) teamPickCounts[homeTeam] = (teamPickCounts[homeTeam] ?? 0) + homeCount;
    if (awayTeam) teamPickCounts[awayTeam] = (teamPickCounts[awayTeam] ?? 0) + awayCount;
  }

  const roundTipsTotal = matches.reduce((sum, m) => sum + Number(m.total_tips ?? 0), 0);
  const mostPicked = Object.entries(teamPickCounts).sort((a, b) => b[1] - a[1])[0] ?? null;
  const mostPickedCount = mostPicked ? Number(mostPicked[1]) : 0;
  const mostPickedPct = roundTipsTotal > 0 ? (mostPickedCount / roundTipsTotal) * 100 : 0;

  return {
    round_number: roundNumber,
    difficulty_pct: difficultyPct,
    average_score: averageScore,
    majority_wins: majorityWins,
    game_count: matches.length,
    minority_winner_count: minorityBackedWinners.length,
    most_picked_team: mostPicked ? mostPicked[0] : null,
    most_picked_count: mostPickedCount,
    most_picked_pct: mostPickedPct,
  };
}

function rankPositionAsc(values: number[], target: number) {
  return 1 + values.filter((v) => Number(v) < Number(target) - 0.0001).length;
}

function rankPositionDesc(values: number[], target: number) {
  return 1 + values.filter((v) => Number(v) > Number(target) + 0.0001).length;
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
    const saveOnly =
      url.searchParams.get("save_only") === "1" ||
      url.searchParams.get("send_email") === "0";
    const skipIfExists = url.searchParams.get("skip_if_exists") === "1";
    const force = url.searchParams.get("force") === "1";
    const recipientOverrideRaw = url.searchParams.get("to_email");
    const recipientOverride = normalizeRecipientEmails(
      parseRecipients(recipientOverrideRaw)
    );
    const hoursAfterFirst = Number(
      url.searchParams.get("hours_after_first") || String(DEFAULT_HOURS_AFTER_FIRST)
    );

    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
    }

    if (roundFilter !== null && (!Number.isFinite(roundFilter) || roundFilter < 0)) {
      return NextResponse.json({ error: "round must be 0 or higher" }, { status: 400 });
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
    if (recipientOverrideRaw && gate.mode !== "bearer") {
      return NextResponse.json(
        { error: "to_email override is only allowed for admin bearer requests" },
        { status: 403 }
      );
    }

    if (recipientOverrideRaw && recipientOverride.length === 0) {
      return NextResponse.json(
        { error: "to_email must include at least one valid email" },
        { status: 400 }
      );
    }

    const envRecipients = normalizeRecipientEmails(
      parseRecipients(process.env.ROUND_RECAP_TO_EMAIL)
    );
    const recipients = saveOnly
      ? []
      : recipientOverride.length > 0
        ? recipientOverride
        : envRecipients;
    const recipientSource = saveOnly
      ? "save_only"
      : recipientOverride.length > 0
        ? "to_email_query_param"
        : "ROUND_RECAP_TO_EMAIL";

    if (!saveOnly && !dryRun && (!resendApiKey || !recapFromEmail || recipients.length === 0)) {
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

    if (!saveOnly) {
      const emailTableCheck = await supabase.from("round_recap_emails").select("id").limit(1);
      if (emailTableCheck.error) {
        return NextResponse.json(
          {
            error: "round_recap_emails table missing or inaccessible",
            details: emailTableCheck.error.message,
            hint: "Apply migration db/migrations/20260308_round_recap_emails.sql",
          },
          { status: 500 }
        );
      }
    }

    const recapTableCheck = await supabase.from("round_recaps").select("id").limit(1);
    if (recapTableCheck.error) {
      return NextResponse.json(
        {
          error: "round_recaps table missing or inaccessible",
          details: recapTableCheck.error.message,
          hint: "Apply migration db/migrations/20260310_round_recaps.sql",
        },
        { status: 500 }
      );
    }

    const competitionId =
      gate.mode === "bearer"
        ? gate.competitionId
        : await getDefaultCompetitionId(supabase);
    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    let roundsQuery = supabase
      .from("rounds")
      .select("id, round_number, lock_time_utc, odds_snapshot_for_time_utc")
      .eq("competition_id", competitionId)
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
      const missingReason =
        roundFilter !== null ? "round_not_found_for_season" : "no_rounds";
      return NextResponse.json({
        ok: true,
        season,
        round: roundFilter,
        hours_after_first: hoursAfterFirst,
        rounds_considered: 0,
        targeted_round: null,
        sent: 0,
        skipped_reason: missingReason,
        hint:
          "No rounds were found for this season/round. Run Sync Fixture (Squiggle) in Admin, then retry.",
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
    const latestLockedRound =
      candidateRounds
        .filter((x) => {
          const lockBase = x.row.lock_time_utc ?? x.first_game_utc;
          const lockMs = new Date(lockBase).getTime();
          return x.match_count > 0 && Number.isFinite(lockMs) && nowMs >= lockMs;
        })
        .map((x) => Number(x.row.round_number))
        .pop() ?? null;
    const latestFinishedRound =
      candidateRounds
        .filter((x) => x.match_count > 0 && x.finished_count === x.match_count)
        .map((x) => Number(x.row.round_number))
        .pop() ?? null;

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
          latest_locked_round: latestLockedRound,
          latest_finished_round: latestFinishedRound,
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
          latest_locked_round: latestLockedRound,
          latest_finished_round: latestFinishedRound,
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
          latest_locked_round: latestLockedRound,
          latest_finished_round: latestFinishedRound,
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
        latest_locked_round: latestLockedRound,
        latest_finished_round: latestFinishedRound,
        targeted_round: null,
        sent: 0,
        skipped_reason: "no_target_round",
      });
    }

    const roundId = String(target.row.id);
    const roundNumber = Number(target.row.round_number);
    const roundMatches = matchRows.filter((m) => String(m.round_id) === roundId);
    const roundMatchIds = roundMatches.map((m) => String(m.id));

    if (skipIfExists && !force && !dryRun) {
      const existingRecap = await supabase
        .from("round_recaps")
        .select("id, generated_at, updated_at")
        .eq("competition_id", competitionId)
        .eq("round_id", roundId)
        .eq("recap_type", RECAP_TYPE)
        .maybeSingle();

      if (existingRecap.error) {
        return NextResponse.json(
          { error: "Failed checking existing round recap", details: existingRecap.error.message },
          { status: 500 }
        );
      }

      if (existingRecap.data?.id) {
        return NextResponse.json({
          ok: true,
          season,
          round: roundNumber,
          recap_type: RECAP_TYPE,
          recipient_source: recipientSource,
          hours_after_first: hoursAfterFirst,
          latest_locked_round: latestLockedRound,
          latest_finished_round: latestFinishedRound,
          targeted_round: roundNumber,
          first_game_utc: target.first_game_utc,
          due_at_utc: target.due_at_utc,
          save_only: saveOnly,
          dry_run: dryRun,
          skip_if_exists: skipIfExists,
          recap_saved: false,
          skipped_reason: "recap_exists",
          existing_generated_at:
            String(
              (existingRecap.data as { generated_at?: string | null }).generated_at ?? ""
            ) || null,
          existing_updated_at:
            String(
              (existingRecap.data as { updated_at?: string | null }).updated_at ?? ""
            ) || null,
          totals: {
            recipients_total: recipients.length,
            recipients_targeted: 0,
            sent: 0,
            simulated: 0,
            failed: 0,
            skipped_existing: recipients.length,
          },
          results: [],
        });
      }
    }

    if (roundMatchIds.length === 0) {
      return NextResponse.json({
        ok: true,
        season,
        round: roundNumber,
        sent: 0,
        skipped_reason: "target_round_has_no_matches",
      });
    }

    let recipientsToSend: string[] = [];
    if (!saveOnly) {
      const existingQuery = await supabase
        .from("round_recap_emails")
        .select("recipient_email")
        .eq("competition_id", competitionId)
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

      recipientsToSend = dryRun
        ? recipients
        : recipients.filter((email) => force || !alreadySent.has(email));

      if (recipientsToSend.length === 0) {
        return NextResponse.json({
          ok: true,
          season,
          round: roundNumber,
          hours_after_first: hoursAfterFirst,
          latest_locked_round: latestLockedRound,
          latest_finished_round: latestFinishedRound,
          targeted_round: roundNumber,
          sent: 0,
          skipped_reason: "already_sent",
          recipients_total: recipients.length,
          recipients_skipped_existing: recipients.length,
        });
      }
    }

    const { data: memberships, error: memErr } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("competition_id", competitionId);

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
      .eq("competition_id", competitionId)
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
    const previousRoundNumber = roundNumber > 0 ? roundNumber - 1 : null;
    const previousRoundResultsUrl =
      previousRoundNumber === null
        ? null
        : `${url.origin}/api/round-results?season=${encodeURIComponent(
            String(season)
          )}&round=${encodeURIComponent(String(previousRoundNumber))}`;
    const leaderboardUrl = `${url.origin}/api/leaderboard?season=${encodeURIComponent(
      String(season)
    )}`;

    const [roundResultsRes, leaderboardRes, previousRoundResultsRes] = await Promise.all([
      fetchJson<RoundResultsResponse>(roundResultsUrl),
      fetchJson<LeaderboardResponse>(leaderboardUrl),
      previousRoundResultsUrl
        ? fetchJson<RoundResultsResponse>(previousRoundResultsUrl)
        : Promise.resolve(null),
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
    const prevRoundPlayers =
      previousRoundResultsRes?.ok && previousRoundResultsRes.data?.ok
        ? ((previousRoundResultsRes.data.players ?? []) as RoundResultsPlayer[])
        : [];

    const completedRoundNumbers = candidateRounds
      .filter(
        (x) => x.finished_count === x.match_count && Number(x.row.round_number) <= Number(roundNumber)
      )
      .map((x) => Number(x.row.round_number))
      .sort((a, b) => a - b);

    const preloadRoundResults = new Map<number, RoundResultsResponse>();
    preloadRoundResults.set(roundNumber, {
      ok: true,
      matches: rrMatches,
      players: rrPlayers,
    });
    if (previousRoundNumber !== null && previousRoundResultsRes?.ok && previousRoundResultsRes.data?.ok) {
      preloadRoundResults.set(previousRoundNumber, previousRoundResultsRes.data);
    }

    const historicalRoundResults = await Promise.all(
      completedRoundNumbers.map(async (rn) => {
        const existing = preloadRoundResults.get(rn);
        if (existing?.ok) {
          return { round_number: rn, data: existing };
        }

        const roundUrl = `${url.origin}/api/round-results?season=${encodeURIComponent(
          String(season)
        )}&round=${encodeURIComponent(String(rn))}`;
        const res = await fetchJson<RoundResultsResponse>(roundUrl);
        if (!res.ok || !res.data?.ok) return null;
        return { round_number: rn, data: res.data };
      })
    );

    const seasonRoundStats = historicalRoundResults
      .filter(
        (
          x
        ): x is {
          round_number: number;
          data: RoundResultsResponse;
        } => !!x
      )
      .map((x) =>
        summarizeRoundAggregateStat({
          roundNumber: x.round_number,
          matches: (x.data.matches ?? []) as RoundResultsMatch[],
          players: ((x.data.players ?? []) as RoundResultsPlayer[]).map((p) => ({
            correct_tips: Number(p.correct_tips ?? 0),
            total_tips: Number(p.total_tips ?? 0),
            round_score: Number(p.round_score ?? 0),
          })),
        })
      )
      .sort((a, b) => a.round_number - b.round_number);

    const winnerOddsByMatch: Record<string, number | null> = {};
    const loserOddsByMatch: Record<string, number | null> = {};

    let oddsQuery = supabase
      .from("match_odds")
      .select("match_id, home_odds, away_odds, captured_at_utc, snapshot_for_time_utc")
      .eq("competition_id", competitionId)
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

    const roundDifficultyPct = computeDifficultyPct(playerStats);
    const roundAvg = computeRoundAverage(playerStats);

    const maxRoundScore = playerStats.length
      ? Math.max(...playerStats.map((p) => Number(p.round_score)))
      : 0;
    const roundWinners = playerStats.filter(
      (p) => Math.abs(Number(p.round_score) - Number(maxRoundScore)) < 0.0001
    );

    const sortedRoundScorers = [...playerStats].sort((a, b) => {
      if (Number(b.round_score) !== Number(a.round_score)) {
        return Number(b.round_score) - Number(a.round_score);
      }
      if (Number(b.correct_tips) !== Number(a.correct_tips)) {
        return Number(b.correct_tips) - Number(a.correct_tips);
      }
      return a.display_name.localeCompare(b.display_name);
    });
    const topRoundScorers = topN(sortedRoundScorers, 5);
    const tiedAtFifth =
      topRoundScorers.length < 5
        ? []
        : sortedRoundScorers
            .slice(5)
            .filter(
              (p) =>
                Math.abs(
                  Number(p.round_score) - Number(topRoundScorers[4].round_score)
                ) < 0.0001
            );

    const previousRoundDifficulty =
      previousRoundNumber !== null && prevRoundPlayers.length > 0
        ? computeDifficultyPct(
            prevRoundPlayers.map((p) => ({
              correct_tips: Number(p.correct_tips ?? 0),
              total_tips: Number(p.total_tips ?? 0),
            }))
          )
        : null;
    const difficultyDelta =
      previousRoundDifficulty === null ? null : roundDifficultyPct - previousRoundDifficulty;

    const topRises = topN(
      [...lbRows]
        .filter((r) => Number(r.movement) > 0)
        .sort((a, b) => Number(b.movement) - Number(a.movement)),
      5
    );
    const topDrops = topN(
      [...lbRows]
        .filter((r) => Number(r.movement) < 0)
        .sort((a, b) => Number(a.movement) - Number(b.movement)),
      5
    );

    const roundTipsTotal = roundTips.length;
    const mostPickedTeam =
      Object.entries(roundTipCountByTeam).sort((a, b) => b[1] - a[1])[0] ?? null;

    const rrMatchById = new Map<string, RoundResultsMatch>();
    rrMatches.forEach((m) => rrMatchById.set(String(m.id), m));

    let biggestUpset:
      | {
          match: MatchRow;
          winner: string;
          winnerOdds: number;
          winnerTipShare: number;
        }
      | null = null;

    for (const m of roundMatches) {
      const mid = String(m.id);
      const winner = String(m.winner_team ?? "").trim();
      if (!winner) continue;

      const winnerOdds = winnerOddsByMatch[mid];
      if (winnerOdds === null) continue;

      const rr = rrMatchById.get(mid);
      const winnerCount = rr
        ? winner === rr.home_team
          ? Number(rr.tipping.home_count)
          : winner === rr.away_team
            ? Number(rr.tipping.away_count)
            : 0
        : 0;
      const winnerTipShare =
        rr && Number(rr.total_tips) > 0 ? (winnerCount / Number(rr.total_tips)) * 100 : 0;

      if (!biggestUpset || Number(winnerOdds) > Number(biggestUpset.winnerOdds)) {
        biggestUpset = {
          match: m,
          winner,
          winnerOdds: Number(winnerOdds),
          winnerTipShare,
        };
      }
    }

    const majorityPickWins = rrMatches.filter((m) => {
      const winner = String(m.winner_team ?? "").trim();
      if (!winner) return false;
      const majorityTeam =
        Number(m.tipping.home_count) >= Number(m.tipping.away_count)
          ? m.home_team
          : m.away_team;
      return winner === majorityTeam;
    }).length;

    const minorityBackedWinners = rrMatches
      .map((m) => {
        const winner = String(m.winner_team ?? "").trim();
        if (!winner || Number(m.total_tips) <= 0) return null;
        const winnerCount =
          winner === m.home_team
            ? Number(m.tipping.home_count)
            : winner === m.away_team
              ? Number(m.tipping.away_count)
              : 0;
        const winnerPct = (winnerCount / Number(m.total_tips)) * 100;
        return { match: m, winner, winnerPct };
      })
      .filter((x): x is { match: RoundResultsMatch; winner: string; winnerPct: number } => !!x)
      .filter((x) => x.winnerPct < 50)
      .sort((a, b) => a.winnerPct - b.winnerPct);

    const fullRoundTips = rrMatches.length;
    const perfectRoundPlayers = playerStats.filter(
      (p) =>
        fullRoundTips > 0 &&
        Number(p.total_tips) === Number(fullRoundTips) &&
        Number(p.correct_tips) === Number(fullRoundTips)
    );
    const zeroAfterTippingAllPlayers = playerStats.filter(
      (p) =>
        fullRoundTips > 0 &&
        Number(p.total_tips) === Number(fullRoundTips) &&
        Number(p.round_score) <= 0 &&
        Number(p.correct_tips) === 0
    );
    const sixPlusWinners = playerStats.filter((p) => Number(p.correct_tips) >= 6).length;
    const fivePlusWinners = playerStats.filter((p) => Number(p.correct_tips) >= 5).length;

    const { data: seasonFinishedRows, error: seasonFinishedErr } = await supabase
      .from("matches")
      .select(
        "id, home_team, away_team, winner_team, round:rounds!inner(round_number, season, competition_id, odds_snapshot_for_time_utc)"
      )
      .not("winner_team", "is", null)
      .eq("round.competition_id", competitionId)
      .eq("round.season", season);

    if (seasonFinishedErr) {
      return NextResponse.json(
        { error: "Failed to read season matches for recap notes", details: seasonFinishedErr.message },
        { status: 500 }
      );
    }

    const seasonFinishedMatches = ((seasonFinishedRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => {
        const rawRound = row.round as
          | {
              round_number?: number;
              odds_snapshot_for_time_utc?: string | null;
            }
          | Array<{ round_number?: number; odds_snapshot_for_time_utc?: string | null }>
          | null
          | undefined;
        const roundObj = Array.isArray(rawRound) ? rawRound[0] ?? null : rawRound ?? null;
        const winner = String(row.winner_team ?? "").trim();
        const snapshot = String(roundObj?.odds_snapshot_for_time_utc ?? "").trim();
        const roundNo = Number(roundObj?.round_number ?? -1);
        if (!winner || !snapshot || !Number.isFinite(roundNo) || roundNo < 0) return null;
        return {
          id: String(row.id ?? ""),
          home_team: String(row.home_team ?? ""),
          away_team: String(row.away_team ?? ""),
          winner_team: winner,
          round_number: roundNo,
          snapshot_for_time_utc: snapshot,
        };
      })
      .filter(
        (
          x
        ): x is {
          id: string;
          home_team: string;
          away_team: string;
          winner_team: string;
          round_number: number;
          snapshot_for_time_utc: string;
        } => !!x && !!x.id
      );

    const seasonLockedSnapshotByMatch = new Map<string, string>(
      seasonFinishedMatches.map((m) => [m.id, m.snapshot_for_time_utc])
    );
    const seasonMatchIds = seasonFinishedMatches.map((m) => m.id);
    const seasonUniqueSnapshots = Array.from(
      new Set(seasonFinishedMatches.map((m) => m.snapshot_for_time_utc))
    );

    const seasonOddsByMatch = new Map<string, { home: number; away: number }>();
    if (seasonMatchIds.length > 0 && seasonUniqueSnapshots.length > 0) {
      const { data: seasonOddsRows, error: seasonOddsErr } = await supabase
        .from("match_odds")
        .select("match_id, home_odds, away_odds, snapshot_for_time_utc, captured_at_utc")
        .eq("competition_id", competitionId)
        .in("match_id", seasonMatchIds)
        .in("snapshot_for_time_utc", seasonUniqueSnapshots)
        .order("captured_at_utc", { ascending: false });

      if (seasonOddsErr) {
        return NextResponse.json(
          { error: "Failed to read season odds for recap notes", details: seasonOddsErr.message },
          { status: 500 }
        );
      }

      for (const row of (seasonOddsRows ?? []) as MatchOddsRow[]) {
        const mid = String(row.match_id);
        const rowSnapshot = String(row.snapshot_for_time_utc ?? "").trim();
        const lockedSnapshot = seasonLockedSnapshotByMatch.get(mid) ?? "";
        if (!lockedSnapshot || rowSnapshot !== lockedSnapshot) continue;
        if (seasonOddsByMatch.has(mid)) continue;
        seasonOddsByMatch.set(mid, {
          home: Number(row.home_odds ?? 0),
          away: Number(row.away_odds ?? 0),
        });
      }
    }

    const seasonUpsetRows = seasonFinishedMatches
      .map((m) => {
        const odds = seasonOddsByMatch.get(m.id);
        if (!odds) return null;
        let winnerOdds: number | null = null;
        if (m.winner_team === m.home_team) winnerOdds = Number(odds.home);
        else if (m.winner_team === m.away_team) winnerOdds = Number(odds.away);
        if (winnerOdds === null || !Number.isFinite(Number(winnerOdds))) return null;
        return {
          match_id: m.id,
          round_number: m.round_number,
          home_team: m.home_team,
          away_team: m.away_team,
          winner_team: m.winner_team,
          winner_odds: Number(winnerOdds),
        };
      })
      .filter(
        (
          x
        ): x is {
          match_id: string;
          round_number: number;
          home_team: string;
          away_team: string;
          winner_team: string;
          winner_odds: number;
        } => !!x
      )
      .sort((a, b) => Number(b.winner_odds) - Number(a.winner_odds));

    const seasonBiggestUpset = seasonUpsetRows[0] ?? null;
    const seasonBiggestUpsetOdds = seasonBiggestUpset ? Number(seasonBiggestUpset.winner_odds) : null;
    const topSeasonUpsets = topN(seasonUpsetRows, 5);

    const oneTipSwapRows = lbRows
      .map((r) => {
        const uid = String(r.user_id);
        const picks = picksByUserMatch.get(uid);
        if (!picks) return null;

        let bestSwap:
          | {
              match: MatchRow;
              fromTeam: string;
              toTeam: string;
              gain: number;
            }
          | null = null;

        for (const m of roundMatches) {
          const mid = String(m.id);
          const winner = String(m.winner_team ?? "").trim();
          if (!winner) continue;
          const picked = String(picks.get(mid) ?? "").trim();
          if (!picked || picked === winner) continue;

          const gain = winnerOddsByMatch[mid];
          if (gain === null || !Number.isFinite(Number(gain))) continue;

          if (!bestSwap || Number(gain) > Number(bestSwap.gain)) {
            bestSwap = {
              match: m,
              fromTeam: picked,
              toTeam: winner,
              gain: Number(gain),
            };
          }
        }

        if (!bestSwap) return null;

        const newTotal = Number(r.total_points) + Number(bestSwap.gain);
        const newRank = 1 + lbRows.filter((x) => Number(x.total_points) > newTotal).length;
        const climbed = Number(r.rank) - Number(newRank);

        return {
          user_id: uid,
          display_name: r.display_name,
          old_rank: Number(r.rank),
          new_rank: Number(newRank),
          climbed: Number(climbed),
          gain: Number(bestSwap.gain),
          new_total: Number(newTotal),
          swap: bestSwap,
        };
      })
      .filter(
        (
          x
        ): x is {
          user_id: string;
          display_name: string;
          old_rank: number;
          new_rank: number;
          climbed: number;
          gain: number;
          new_total: number;
          swap: {
            match: MatchRow;
            fromTeam: string;
            toTeam: string;
            gain: number;
          };
        } => !!x && Number(x.climbed) > 0
      )
      .sort((a, b) => {
        if (Number(b.climbed) !== Number(a.climbed)) return Number(b.climbed) - Number(a.climbed);
        if (Number(b.gain) !== Number(a.gain)) return Number(b.gain) - Number(a.gain);
        return Number(a.old_rank) - Number(b.old_rank);
      });
    const bestOneTipSwap = oneTipSwapRows[0] ?? null;
    const nextBestOneTipSwaps = oneTipSwapRows.slice(1, 3);

    const headlineBits: string[] = [];
    if (roundWinners.length > 0) {
      headlineBits.push(
        `Round winner: ${humanList(roundWinners.map((w) => w.display_name))} (${fmt2(
          maxRoundScore
        )} pts)`
      );
    }
    headlineBits.push(`Round difficulty: ${fmt2(roundDifficultyPct)}% correct`);
    if (biggestUpset) {
      headlineBits.push(`Biggest upset: ${biggestUpset.winner} at ${fmt2(biggestUpset.winnerOdds)}`);
    }

    const subject = `Round ${roundNumber} recap (${season})`;
    const generatedAtIso = new Date().toISOString();

    const textLines: string[] = [];
    const lbByUserId = new Map(lbRows.map((r) => [String(r.user_id), r]));
    const topScorerUserIds = new Set(topRoundScorers.map((p) => String(p.user_id)));
    const top3Rows = topN(lbRows, 3);
    const extraClimber = topRises.find((r) => !topScorerUserIds.has(String(r.user_id))) ?? null;
    const seasonSecondBiggestUpset =
      seasonBiggestUpsetOdds === null
        ? null
        : seasonUpsetRows.find(
            (x) => Number(x.winner_odds) < Number(seasonBiggestUpsetOdds) - 0.0001
          ) ?? null;
    const currentRoundAggregate =
      seasonRoundStats.find((x) => Number(x.round_number) === Number(roundNumber)) ??
      summarizeRoundAggregateStat({
        roundNumber,
        matches: rrMatches,
        players: playerStats.map((p) => ({
          correct_tips: Number(p.correct_tips),
          total_tips: Number(p.total_tips),
          round_score: Number(p.round_score),
        })),
      });

    const rankTrends = Array.isArray(leaderboardRes.data.rank_trends)
      ? leaderboardRes.data.rank_trends
      : [];
    const movementEvents = rankTrends.flatMap((series) => {
      const points = [...(series.points ?? [])].sort(
        (a, b) => Number(a.round_number) - Number(b.round_number)
      );
      const events: Array<{
        user_id: string;
        display_name: string;
        from_round: number;
        to_round: number;
        from_rank: number;
        to_rank: number;
        delta: number;
      }> = [];

      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const cur = points[i];
        const toRoundNo = Number(cur.round_number);
        if (!Number.isFinite(toRoundNo) || toRoundNo > Number(roundNumber)) continue;
        const fromRank = Number(prev.rank);
        const toRank = Number(cur.rank);
        const delta = fromRank - toRank;
        events.push({
          user_id: String(series.user_id),
          display_name: String(series.display_name ?? ""),
          from_round: Number(prev.round_number),
          to_round: toRoundNo,
          from_rank: fromRank,
          to_rank: toRank,
          delta,
        });
      }
      return events;
    });

    const historicalContextCandidates: Array<{
      id: string;
      priority: number;
      line: string;
    }> = [];

    if (seasonRoundStats.length >= 2) {
      const roundCount = seasonRoundStats.length;
      const difficultyValues = seasonRoundStats.map((x) => Number(x.difficulty_pct));
      const hardRank = rankPositionAsc(difficultyValues, Number(currentRoundAggregate.difficulty_pct));
      const avgValues = seasonRoundStats.map((x) => Number(x.average_score));
      const avgHighRank = rankPositionDesc(avgValues, Number(currentRoundAggregate.average_score));
      const avgLowRank = rankPositionAsc(avgValues, Number(currentRoundAggregate.average_score));

      if (hardRank === 1) {
        historicalContextCandidates.push({
          id: "difficulty-hardest",
          priority: 100,
          line: `Hardest tipping round so far: ${fmt2(
            Number(currentRoundAggregate.difficulty_pct)
          )}% is the lowest of ${roundCount} completed rounds.`,
        });
      } else if (hardRank <= 2) {
        historicalContextCandidates.push({
          id: "difficulty-top2-hard",
          priority: 72,
          line: `This was one of the two toughest rounds so far (ranked ${ordinal(
            hardRank
          )} hardest out of ${roundCount}).`,
        });
      } else if (hardRank === roundCount) {
        historicalContextCandidates.push({
          id: "difficulty-easiest",
          priority: 72,
          line: `This was the easiest round to tip so far (${fmt2(
            Number(currentRoundAggregate.difficulty_pct)
          )}% correct).`,
        });
      }

      if (hardRank === 1 && avgHighRank <= 2) {
        historicalContextCandidates.push({
          id: "avg-high-despite-hard",
          priority: 94,
          line: `Despite the low accuracy, the ${fmt2(
            Number(currentRoundAggregate.average_score)
          )} average score is still the ${ordinal(avgHighRank)} highest of the season.`,
        });
      } else if (avgHighRank === 1) {
        historicalContextCandidates.push({
          id: "avg-highest",
          priority: 78,
          line: `Average round score of ${fmt2(
            Number(currentRoundAggregate.average_score)
          )} is the season high.`,
        });
      } else if (avgHighRank === 2) {
        historicalContextCandidates.push({
          id: "avg-second-highest",
          priority: 70,
          line: `Average score of ${fmt2(
            Number(currentRoundAggregate.average_score)
          )} is the ${ordinal(2)} highest this season.`,
        });
      } else if (avgLowRank === 1) {
        historicalContextCandidates.push({
          id: "avg-lowest",
          priority: 70,
          line: `Average score of ${fmt2(
            Number(currentRoundAggregate.average_score)
          )} is the lowest this season.`,
        });
      }

      const majorityRates = seasonRoundStats.map((x) =>
        Number(x.game_count) > 0 ? (Number(x.majority_wins) / Number(x.game_count)) * 100 : 0
      );
      const majorityRateCurrent =
        Number(currentRoundAggregate.game_count) > 0
          ? (Number(currentRoundAggregate.majority_wins) / Number(currentRoundAggregate.game_count)) *
            100
          : 0;
      const majorityRateLowRank = rankPositionAsc(majorityRates, majorityRateCurrent);
      const majorityRateHighRank = rankPositionDesc(majorityRates, majorityRateCurrent);

      if (majorityRateLowRank === 1) {
        historicalContextCandidates.push({
          id: "majority-lowest",
          priority: 86,
          line: `Consensus struggled: majority picks won only ${fmt1(
            majorityRateCurrent
          )}% of games, the lowest hit rate this season.`,
        });
      } else if (majorityRateHighRank === 1) {
        historicalContextCandidates.push({
          id: "majority-highest",
          priority: 66,
          line: `Consensus nailed it this week: majority picks had the best hit rate of the season (${fmt1(
            majorityRateCurrent
          )}%).`,
        });
      }

      const minorityWinnerCounts = seasonRoundStats.map((x) => Number(x.minority_winner_count));
      const minorityHighRank = rankPositionDesc(
        minorityWinnerCounts,
        Number(currentRoundAggregate.minority_winner_count)
      );

      if (Number(currentRoundAggregate.minority_winner_count) > 0 && minorityHighRank === 1) {
        historicalContextCandidates.push({
          id: "minority-highest",
          priority: 84,
          line: `${currentRoundAggregate.minority_winner_count} minority-backed winners is the highest count of the season.`,
        });
      } else if (Number(currentRoundAggregate.minority_winner_count) >= 3 && minorityHighRank <= 2) {
        historicalContextCandidates.push({
          id: "minority-top2",
          priority: 62,
          line: `This was one of the more volatile rounds: ${currentRoundAggregate.minority_winner_count} winners were backed by fewer than half the comp.`,
        });
      }

      const mostPickedPcts = seasonRoundStats
        .map((x) => Number(x.most_picked_pct))
        .filter((x) => Number.isFinite(x) && x > 0);
      if (mostPickedPcts.length >= 2 && Number(currentRoundAggregate.most_picked_pct) > 0) {
        const consensusHighRank = rankPositionDesc(
          mostPickedPcts,
          Number(currentRoundAggregate.most_picked_pct)
        );
        const consensusLowRank = rankPositionAsc(
          mostPickedPcts,
          Number(currentRoundAggregate.most_picked_pct)
        );
        if (consensusHighRank === 1 && currentRoundAggregate.most_picked_team) {
          historicalContextCandidates.push({
            id: "most-picked-highest",
            priority: 58,
            line: `${currentRoundAggregate.most_picked_team} drew the strongest single-game consensus of the season (${fmt1(
              Number(currentRoundAggregate.most_picked_pct)
            )}%).`,
          });
        } else if (consensusLowRank === 1 && currentRoundAggregate.most_picked_team) {
          historicalContextCandidates.push({
            id: "most-picked-lowest",
            priority: 58,
            line: `Even the most-picked side (${currentRoundAggregate.most_picked_team}) had the lowest top-consensus share of the season (${fmt1(
              Number(currentRoundAggregate.most_picked_pct)
            )}%).`,
          });
        }
      }
    }

    if (biggestUpset && seasonUpsetRows.length > 0) {
      const upsetRank =
        1 +
        seasonUpsetRows.filter(
          (x) => Number(x.winner_odds) > Number(biggestUpset.winnerOdds) + 0.0001
        ).length;

      if (upsetRank === 1 && seasonSecondBiggestUpset) {
        historicalContextCandidates.push({
          id: "upset-new-1",
          priority: 96,
          line: `${biggestUpset.winner} at ${fmt2(
            Number(biggestUpset.winnerOdds)
          )} is now the biggest upset of 2026, passing Round ${seasonSecondBiggestUpset.round_number} (${seasonSecondBiggestUpset.winner_team} @ ${fmt2(
            Number(seasonSecondBiggestUpset.winner_odds)
          )}).`,
        });
      } else if (upsetRank <= 3) {
        const higherUpset = seasonUpsetRows.find(
          (x) => Number(x.winner_odds) > Number(biggestUpset.winnerOdds) + 0.0001
        );
        const suffix = higherUpset
          ? ` Only Round ${higherUpset.round_number} (${higherUpset.winner_team} @ ${fmt2(
              Number(higherUpset.winner_odds)
            )}) was bigger.`
          : "";
        historicalContextCandidates.push({
          id: `upset-rank-${upsetRank}`,
          priority: 80,
          line: `${biggestUpset.winner} at ${fmt2(
            Number(biggestUpset.winnerOdds)
          )} ranks as the #${upsetRank} upset of the season.${suffix}`,
        });
      }
    }

    const seasonClimbEvents = movementEvents.filter((x) => Number(x.delta) > 0);
    const seasonDropEvents = movementEvents.filter((x) => Number(x.delta) < 0);
    const roundClimbEvent =
      seasonClimbEvents
        .filter((x) => Number(x.to_round) === Number(roundNumber))
        .sort((a, b) => Number(b.delta) - Number(a.delta))[0] ?? null;
    const roundDropEvent =
      seasonDropEvents
        .filter((x) => Number(x.to_round) === Number(roundNumber))
        .sort((a, b) => Number(a.delta) - Number(b.delta))[0] ?? null;

    if (roundClimbEvent) {
      const climbMagnitude = Number(roundClimbEvent.delta);
      const climbRank =
        1 +
        seasonClimbEvents.filter((x) => Number(x.delta) > Number(climbMagnitude) + 0.0001).length;
      if (climbRank <= 3) {
        const climbRankLabel =
          climbRank === 1
            ? "the biggest"
            : `the ${ordinal(climbRank)} biggest`;
        historicalContextCandidates.push({
          id: `climb-rank-${climbRank}`,
          priority: 64,
          line: `${atHandle(roundClimbEvent.display_name)}'s +${Math.trunc(
            climbMagnitude
          )} climb is tied for ${climbRankLabel} single-round rise this season.`,
        });
      }
    }

    if (roundDropEvent) {
      const dropMagnitude = Math.abs(Number(roundDropEvent.delta));
      const dropRank =
        1 +
        seasonDropEvents.filter((x) => Math.abs(Number(x.delta)) > Number(dropMagnitude) + 0.0001)
          .length;
      if (dropRank <= 3) {
        const dropRankLabel =
          dropRank === 1
            ? "the biggest"
            : `the ${ordinal(dropRank)} biggest`;
        historicalContextCandidates.push({
          id: `drop-rank-${dropRank}`,
          priority: 76,
          line: `${atHandle(roundDropEvent.display_name)}'s -${Math.trunc(
            dropMagnitude
          )} is tied for ${dropRankLabel} single-round drop so far.`,
        });
      }
    }

    const historicalContextLines = historicalContextCandidates
      .sort((a, b) => Number(b.priority) - Number(a.priority))
      .filter((x, index, all) => all.findIndex((y) => y.id === x.id) === index)
      .slice(0, 4)
      .map((x) => x.line);

    const sillyHeading = pickByRound(roundNumber, [
      "Some more silly data.",
      "More stat nonsense for the group chat.",
      "Extra stat chaos.",
      "A few bonus numbers for the stat sickos.",
    ]);

    if (roundWinners.length === 1) {
      const winner = roundWinners[0];
      const winnerLb = lbByUserId.get(String(winner.user_id)) ?? null;
      const winnerMove =
        winnerLb && Number(winnerLb.movement) !== 0
          ? ` This shifts ${atHandle(winner.display_name)} ${fmtSigned(
              Number(winnerLb.movement)
            )} and into ${ordinal(Number(winnerLb.rank))} overall.`
          : "";
      textLines.push(
        `Round ${roundNumber} is complete, with ${atHandle(
          winner.display_name
        )} top-scoring on ${fmt2(maxRoundScore)} points.${winnerMove}`
      );
    } else {
      textLines.push(
        `Round ${roundNumber} is complete, with ${humanList(
          roundWinners.map((w) => atHandle(w.display_name))
        )} sharing top score on ${fmt2(maxRoundScore)} points.`
      );
    }

    textLines.push("");
    textLines.push("Next highest scorers:");
    for (let idx = 1; idx <= 4; idx += 1) {
      const scorer = topRoundScorers[idx];
      if (!scorer) {
        textLines.push(`${idx + 1}. n/a`);
        continue;
      }
      const lbRow = lbByUserId.get(String(scorer.user_id)) ?? null;
      const movementSuffix =
        lbRow && Number(lbRow.movement) !== 0 ? ` (${fmtSigned(Number(lbRow.movement))})` : "";
      const rankSuffix = lbRow ? ` now ${ordinal(Number(lbRow.rank))} overall` : "";
      textLines.push(
        `${idx + 1}. ${atHandle(scorer.display_name)} - ${fmt2(
          Number(scorer.round_score)
        )}${movementSuffix}${rankSuffix}`
      );
    }
    if (tiedAtFifth.length > 0 && topRoundScorers.length >= 5) {
      textLines.push(
        `Also on ${fmt2(Number(topRoundScorers[4].round_score))}: ${humanList(
          tiedAtFifth.map((p) => atHandle(p.display_name))
        )}.`
      );
    }

    if (extraClimber) {
      textLines.push("");
      textLines.push(
        `Outside the top scorers, biggest mover was ${atHandle(
          extraClimber.display_name
        )} (${fmtSigned(Number(extraClimber.movement))}) and into ${ordinal(
          Number(extraClimber.rank)
        )}.`
      );
    }

    textLines.push("");
    textLines.push(`Leaderboard after Round ${roundNumber}:`);
    if (top3Rows.length > 0) {
      textLines.push(`1. ${atHandle(top3Rows[0].display_name)}`);
    }
    if (top3Rows.length > 1) {
      textLines.push(
        `2. ${atHandle(top3Rows[1].display_name)} (-${fmt2(Number(top3Rows[1].behind_leader))})`
      );
    }
    if (top3Rows.length > 2) {
      textLines.push(
        `3. ${atHandle(top3Rows[2].display_name)} (-${fmt2(Number(top3Rows[2].behind_leader))})`
      );
    }

    textLines.push("");
    textLines.push(
      `${pickByRound(roundNumber, [
        "Round difficulty was",
        "This week's difficulty came in at",
        "Round difficulty landed at",
      ])} ${fmt2(roundDifficultyPct)}% correct tips, with an average score of ${fmt2(roundAvg)}.`
    );
    if (previousRoundNumber !== null && previousRoundDifficulty !== null && difficultyDelta !== null) {
      textLines.push(
        `Compared to Round ${previousRoundNumber} (${fmt2(previousRoundDifficulty)}%), Round ${roundNumber} was ${fmt2(
          Math.abs(difficultyDelta)
        )} percentage points ${difficultyDelta >= 0 ? "easier" : "harder"}.`
      );
    } else {
      textLines.push("No previous completed round baseline was available for comparison.");
    }

    textLines.push("");
    textLines.push("Biggest climbers:");
    topN(topRises, 5).forEach((r, idx) =>
      textLines.push(`${idx + 1}. ${atHandle(r.display_name)} (${fmtSigned(Number(r.movement))})`)
    );
    if (topRises.length === 0) textLines.push("1. n/a");

    textLines.push("");
    textLines.push("Biggest fallers:");
    topN(topDrops, 5).forEach((r, idx) =>
      textLines.push(`${idx + 1}. ${atHandle(r.display_name)} (${fmtSigned(Number(r.movement))})`)
    );
    if (topDrops.length === 0) textLines.push("1. n/a");

    textLines.push("");
    if (biggestUpset) {
      textLines.push(
        `Biggest upset this week: ${biggestUpset.winner} at ${fmt2(
          biggestUpset.winnerOdds
        )} (backed by ${fmt1(biggestUpset.winnerTipShare)}%).`
      );
    } else {
      textLines.push("Biggest upset this week: n/a.");
    }
    if (mostPickedTeam) {
      const mostPickedPct =
        roundTipsTotal > 0 ? (Number(mostPickedTeam[1]) / Number(roundTipsTotal)) * 100 : 0;
      textLines.push(
        `Most-picked side: ${mostPickedTeam[0]} (${mostPickedTeam[1]} picks, ${fmt1(
          mostPickedPct
        )}%).`
      );
    } else {
      textLines.push("Most-picked side: n/a.");
    }

    textLines.push("");
    textLines.push(sillyHeading);
    textLines.push(
      `* ${pickByRound(roundNumber, [
        "Majority pick won",
        "The majority side won",
        "Consensus pick won",
      ])} ${majorityPickWins} of ${rrMatches.length} games.`
    );
    if (minorityBackedWinners.length > 0) {
      textLines.push(
        `* Only ${minorityBackedWinners.length} winner${
          minorityBackedWinners.length === 1 ? "" : "s"
        } were backed by fewer than half the comp: ${humanList(
          minorityBackedWinners.map((x) => `${x.winner} (${fmt1(x.winnerPct)}%)`)
        )}.`
      );
    } else {
      textLines.push("* Every winner was backed by at least half the comp.");
    }
    textLines.push(
      perfectRoundPlayers.length > 0
        ? `* Perfect round check: ${humanList(
            perfectRoundPlayers.map((p) => atHandle(p.display_name))
          )} hit ${fullRoundTips}/${fullRoundTips}.`
        : `* Perfect round check: no one went ${fullRoundTips}/${fullRoundTips}.`
    );
    textLines.push(
      zeroAfterTippingAllPlayers.length > 0
        ? `* Zero-score-after-tipping check: ${humanList(
            zeroAfterTippingAllPlayers.map((p) => atHandle(p.display_name))
          )} scored 0 after tipping all ${fullRoundTips}.`
        : `* Zero-score-after-tipping check: no one scored 0 after tipping all ${fullRoundTips} games.`
    );
    historicalContextLines.forEach((line) => textLines.push(`* ${line}`));
    if (historicalContextLines.length === 0) {
      if (seasonBiggestUpset) {
        textLines.push(
          `* Season-high upset remains ${seasonBiggestUpset.winner_team} @ ${fmt2(
            Number(seasonBiggestUpset.winner_odds)
          )} (Round ${seasonBiggestUpset.round_number}).`
        );
      } else {
        textLines.push("* Season context is still building as more rounds complete.");
      }
    }
    textLines.push(
      `* ${fivePlusWinners} tippers hit 5+ winners; ${sixPlusWinners} hit 6+.`
    );

    if (topSeasonUpsets.length > 0) {
      textLines.push("* Top 5 biggest upsets so far:");
      topSeasonUpsets.forEach((x, idx) =>
        textLines.push(
          `  ${idx + 1}. Round ${x.round_number} - ${x.home_team} vs ${x.away_team} (${x.winner_team} @ ${fmt2(
            Number(x.winner_odds)
          )})`
        )
      );
    }

    textLines.push("");
    if (bestOneTipSwap) {
      textLines.push(
        `And \"Why oh why did I pick them\" this round goes to: ${atHandle(
          bestOneTipSwap.display_name
        )}!!`
      );
      textLines.push(
        `They would have gone from ${ordinal(bestOneTipSwap.old_rank)} to ${ordinal(
          bestOneTipSwap.new_rank
        )} (${fmtSigned(bestOneTipSwap.climbed)} places) had they changed ${bestOneTipSwap.swap.fromTeam} to ${bestOneTipSwap.swap.toTeam}.`
      );
    } else {
      textLines.push(`And \"Why oh why did I pick them\" had no winner this round.`);
    }
    if (nextBestOneTipSwaps.length > 0) {
      textLines.push(
        `Next closest: ${nextBestOneTipSwaps
          .map(
            (x) =>
              `${atHandle(x.display_name)} (${ordinal(x.old_rank)} to ${ordinal(x.new_rank)}, ${fmtSigned(
                x.climbed
              )})`
          )
          .join("; ")}.`
      );
    }

    const text = textLines.join("\n");
    const narrativeText = text;
    const rawStatsText = "";
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
        player_count: playerStats.length,
        match_count: rrMatches.length,
        round_difficulty_pct: round2(roundDifficultyPct),
      },
      headline_bits: headlineBits,
    };

    let recapSaved = false;
    if (!dryRun) {
      const { error: recapErr } = await supabase.from("round_recaps").upsert(
        {
          competition_id: competitionId,
          round_id: roundId,
          season,
          round_number: roundNumber,
          recap_type: RECAP_TYPE,
          subject,
          narrative_text: narrativeText,
          raw_stats_text: rawStatsText,
          email_text: text,
          email_html: html,
          summary_json: payloadForLog,
          generated_at: generatedAtIso,
          updated_at: generatedAtIso,
        },
        {
          onConflict: "competition_id,round_id,recap_type",
        }
      );

      if (recapErr) {
        return NextResponse.json(
          { error: "Failed to save round recap", details: recapErr.message },
          { status: 500 }
        );
      }
      recapSaved = true;
    }

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
            competition_id: competitionId,
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
      recipient_source: recipientSource,
      hours_after_first: hoursAfterFirst,
      latest_locked_round: latestLockedRound,
      latest_finished_round: latestFinishedRound,
      targeted_round: roundNumber,
      first_game_utc: target.first_game_utc,
      due_at_utc: target.due_at_utc,
      save_only: saveOnly,
      dry_run: dryRun,
      skip_if_exists: skipIfExists,
      recap_saved: recapSaved,
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
