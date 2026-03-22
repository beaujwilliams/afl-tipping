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
    const recipients =
      recipientOverride.length > 0 ? recipientOverride : envRecipients;
    const recipientSource =
      recipientOverride.length > 0 ? "to_email_query_param" : "ROUND_RECAP_TO_EMAIL";

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

    const playerStatByUserId = new Map(playerStats.map((p) => [String(p.user_id), p]));

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

    const tipInsightForUser = (userId: string) => {
      const p = playerStatByUserId.get(String(userId));
      if (!p) return "tip data unavailable";
      const submitted = Number(p.total_tips);
      const games = Number(rrMatches.length);

      if (submitted === 0) return "didn't submit tips this round";
      if (submitted < games) {
        return `submitted ${submitted}/${games} tips and scored ${fmt2(Number(p.round_score))} points`;
      }
      if (Number(p.correct_tips) === games) return `nailed a perfect ${games}/${games}`;
      if (Number(p.round_score) <= 0 && Number(p.correct_tips) === 0) {
        return `went 0/${games} despite tipping every game`;
      }
      if (Number(p.underdog_points) > 0) {
        return `hit ${p.correct_tips}/${games} and banked ${fmt2(
          Number(p.underdog_points)
        )} underdog points`;
      }
      return `hit ${p.correct_tips}/${games} for ${fmt2(Number(p.round_score))} points`;
    };

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
    const seasonBiggestUpsetsThisRound =
      seasonBiggestUpsetOdds === null
        ? []
        : seasonUpsetRows.filter(
            (x) =>
              x.round_number === roundNumber &&
              Math.abs(Number(x.winner_odds) - Number(seasonBiggestUpsetOdds)) < 0.0001
          );

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
    const winnerHeadline =
      roundWinners.length === 1
        ? `${roundWinners[0].display_name} topped the week with ${fmt2(maxRoundScore)} points.`
        : `${humanList(roundWinners.map((w) => w.display_name))} topped the week with ${fmt2(
            maxRoundScore
          )} points.`;

    textLines.push(`Round ${roundNumber} is complete, and ${winnerHeadline}`);
    textLines.push("");
    textLines.push("Next highest scorers:");
    for (let idx = 1; idx < Math.min(5, topRoundScorers.length); idx += 1) {
      const p = topRoundScorers[idx];
      textLines.push(`${idx + 1}. ${p.display_name} - ${fmt2(Number(p.round_score))}`);
    }
    if (topRoundScorers.length <= 1) {
      textLines.push("2. n/a");
      textLines.push("3. n/a");
      textLines.push("4. n/a");
      textLines.push("5. n/a");
    } else if (topRoundScorers.length < 5) {
      for (let idx = topRoundScorers.length + 1; idx <= 5; idx += 1) {
        textLines.push(`${idx}. n/a`);
      }
    }
    if (tiedAtFifth.length > 0 && topRoundScorers.length >= 5) {
      textLines.push(
        `Also on ${fmt2(Number(topRoundScorers[4].round_score))}: ${humanList(
          tiedAtFifth.map((p) => p.display_name)
        )}.`
      );
    }
    textLines.push("");

    textLines.push(
      `Round difficulty landed at ${fmt2(
        roundDifficultyPct
      )}% correct tips, with an average round score of ${fmt2(roundAvg)}.`
    );
    if (previousRoundNumber !== null && previousRoundDifficulty !== null && difficultyDelta !== null) {
      const difficultyGapAbs = Math.abs(difficultyDelta);
      textLines.push(
        `Compared to Round ${previousRoundNumber} (${fmt2(previousRoundDifficulty)}%), Round ${roundNumber} was ${
          difficultyDelta >= 0 ? "+" : "-"
        }${fmt2(difficultyGapAbs)} percentage points ${difficultyDelta >= 0 ? "easier" : "harder"}.`
      );
    } else {
      textLines.push(
        "Compared to previous round: N/A (this is the first completed round, so it sets the baseline)."
      );
    }
    textLines.push("");

    textLines.push("5 biggest climbers");
    if (topRises.length > 0) {
      topRises.forEach((r) => {
        textLines.push(
          `- ${r.display_name} (${fmtSigned(Number(r.movement))}): ${tipInsightForUser(String(
            r.user_id
          ))}.`
        );
      });
    } else {
      textLines.push("- None.");
    }
    textLines.push("");

    textLines.push("5 biggest fallers");
    if (topDrops.length > 0) {
      topDrops.forEach((r) => {
        textLines.push(
          `- ${r.display_name} (${fmtSigned(Number(r.movement))}): ${tipInsightForUser(String(
            r.user_id
          ))}.`
        );
      });
    } else {
      textLines.push("- None.");
    }
    textLines.push("");

    if (biggestUpset) {
      textLines.push(
        `Biggest upset this week: ${biggestUpset.winner} at ${fmt2(
          biggestUpset.winnerOdds
        )} (backed by only ${fmt1(biggestUpset.winnerTipShare)}%).`
      );
    } else {
      textLines.push("Biggest upset this week: n/a.");
    }
    if (mostPickedTeam) {
      const mostPickedPct =
        roundTipsTotal > 0 ? (Number(mostPickedTeam[1]) / Number(roundTipsTotal)) * 100 : 0;
      textLines.push(
        `Most-picked side: ${mostPickedTeam[0]} (${mostPickedTeam[1]} picks, ${fmt1(mostPickedPct)}%).`
      );
    } else {
      textLines.push("Most-picked side: n/a.");
    }
    textLines.push("");

    textLines.push("Extra round notes:");
    textLines.push(`- Majority pick won ${majorityPickWins} of ${rrMatches.length} games.`);
    if (minorityBackedWinners.length > 0) {
      textLines.push(
        `- ${minorityBackedWinners.length} winner${
          minorityBackedWinners.length === 1 ? "" : "s"
        } ${minorityBackedWinners.length === 1 ? "was" : "were"} backed by fewer than half the comp: ${humanList(
          minorityBackedWinners.map((x) => `${x.winner} (${fmt1(x.winnerPct)}%)`)
        )}.`
      );
    } else {
      textLines.push("- No winners were backed by fewer than half the comp.");
    }
    if (perfectRoundPlayers.length > 0) {
      textLines.push(
        `- Perfect round check: ${humanList(
          perfectRoundPlayers.map((p) => p.display_name)
        )} nailed ${fullRoundTips}/${fullRoundTips}.`
      );
    } else {
      textLines.push(`- Perfect round check: no one went ${fullRoundTips}/${fullRoundTips}.`);
    }
    if (zeroAfterTippingAllPlayers.length > 0) {
      textLines.push(
        `- Zero-score-after-tipping check: ${humanList(
          zeroAfterTippingAllPlayers.map((p) => p.display_name)
        )} scored 0 despite tipping all ${fullRoundTips} games.`
      );
    } else {
      textLines.push(
        `- Zero-score-after-tipping check: no one scored 0 after tipping all ${fullRoundTips} games.`
      );
    }
    if (seasonBiggestUpset && seasonBiggestUpsetsThisRound.length > 0) {
      textLines.push(
        `- Biggest upset-by-points check: yes. This round matched the season high at ${fmt2(
          Number(seasonBiggestUpset.winner_odds)
        )}.`
      );
    } else if (seasonBiggestUpset) {
      textLines.push(
        `- Biggest upset-by-points check: no. Season high remains ${seasonBiggestUpset.winner_team} at ${fmt2(
          Number(seasonBiggestUpset.winner_odds)
        )} in Round ${seasonBiggestUpset.round_number}.`
      );
    } else {
      textLines.push("- Biggest upset-by-points check: unavailable.");
    }
    textLines.push(
      `- ${fivePlusWinners} tipster${fivePlusWinners === 1 ? "" : "s"} hit 5+ winners; ${sixPlusWinners} hit 6+.`
    );
    textLines.push("");

    textLines.push(`\"Why oh why did I pick them\" this round goes to:`);
    if (bestOneTipSwap) {
      textLines.push(`- ${bestOneTipSwap.display_name}`);
      textLines.push(
        `- Would have gone from ${ordinal(bestOneTipSwap.old_rank)} to ${ordinal(
          bestOneTipSwap.new_rank
        )} (${fmtSigned(bestOneTipSwap.climbed)} places)`
      );
      textLines.push(
        `- Swap: ${bestOneTipSwap.swap.fromTeam} -> ${bestOneTipSwap.swap.toTeam} in ${bestOneTipSwap.swap.match.home_team} vs ${bestOneTipSwap.swap.match.away_team}`
      );
      textLines.push(`- Estimated points gain: +${fmt2(bestOneTipSwap.gain)}`);
    } else {
      textLines.push("- No positive one-tip swap scenarios this round.");
    }
    if (nextBestOneTipSwaps.length > 0) {
      textLines.push("Next closest:");
      nextBestOneTipSwaps.forEach((x) =>
        textLines.push(
          `- ${x.display_name}: ${fmtSigned(x.climbed)} places (${ordinal(x.old_rank)} -> ${ordinal(
            x.new_rank
          )})`
        )
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
      targeted_round: roundNumber,
      first_game_utc: target.first_game_utc,
      due_at_utc: target.due_at_utc,
      dry_run: dryRun,
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
