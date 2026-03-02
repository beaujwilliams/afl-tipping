import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

const SPORT_KEY = "aussierules_afl";
const REGIONS = "au";
const MARKETS = "h2h";
const BOOKMAKER = "sportsbet";

/* ---------------- TYPES ---------------- */

type OddsApiOutcome = { name: string; price: number };
type OddsApiMarket = { key: string; outcomes: OddsApiOutcome[] };
type OddsApiBookmaker = {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
};
type OddsApiEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
};

/* ---------------- TEAM NORMALISATION ---------------- */

const TEAM_ALIASES: Record<string, string> = {
  Adelaide: "Adelaide Crows",
  "Adelaide Crows": "Adelaide Crows",

  Brisbane: "Brisbane Lions",
  "Brisbane Lions": "Brisbane Lions",

  Carlton: "Carlton",
  "Carlton Blues": "Carlton",

  Collingwood: "Collingwood",
  "Collingwood Magpies": "Collingwood",

  Essendon: "Essendon",
  "Essendon Bombers": "Essendon",

  Fremantle: "Fremantle",
  "Fremantle Dockers": "Fremantle",

  Geelong: "Geelong Cats",
  "Geelong Cats": "Geelong Cats",

  "Gold Coast": "Gold Coast Suns",
  "Gold Coast Suns": "Gold Coast Suns",

  GWS: "Greater Western Sydney Giants",
  "GWS Giants": "Greater Western Sydney Giants",
  "Greater Western Sydney": "Greater Western Sydney Giants",
  "Greater Western Sydney Giants": "Greater Western Sydney Giants",

  Hawthorn: "Hawthorn",
  "Hawthorn Hawks": "Hawthorn",

  Melbourne: "Melbourne Demons",
  "Melbourne Demons": "Melbourne Demons",

  "North Melbourne": "North Melbourne Kangaroos",
  Kangaroos: "North Melbourne Kangaroos",
  "North Melbourne Kangaroos": "North Melbourne Kangaroos",

  "Port Adelaide": "Port Adelaide Power",
  "Port Adelaide Power": "Port Adelaide Power",

  Richmond: "Richmond",
  "Richmond Tigers": "Richmond",

  "St Kilda": "St Kilda",
  "St Kilda Saints": "St Kilda",

  Sydney: "Sydney Swans",
  "Sydney Swans": "Sydney Swans",

  "West Coast": "West Coast Eagles",
  "West Coast Eagles": "West Coast Eagles",

  "Western Bulldogs": "Western Bulldogs",
  Bulldogs: "Western Bulldogs",
};

function normTeam(name: string) {
  const key = name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bFC\b/i, "")
    .replace(/\bFootball Club\b/i, "")
    .trim();

  return TEAM_ALIASES[key] ?? key;
}

function sameMatch(aHome: string, aAway: string, bHome: string, bAway: string) {
  const ah = normTeam(aHome);
  const aa = normTeam(aAway);
  const bh = normTeam(bHome);
  const ba = normTeam(bAway);

  return (ah === bh && aa === ba) || (ah === ba && aa === bh);
}

/* ---------------- TIME HELPERS ---------------- */

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The Odds API requires YYYY-MM-DDTHH:MM:SSZ (no milliseconds)
function toOddsApiUtc(isoWithMs: string) {
  return isoWithMs.replace(/\.\d{3}Z$/, "Z");
}

// 12pm Melbourne time day before round lock
function computeSnapshotForTimeUtc(lockTimeUtcIso: string) {
  const lock = new Date(lockTimeUtcIso);

  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(lock);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  const utcBase = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  utcBase.setUTCDate(utcBase.getUTCDate() - 1);

  const yyyy = utcBase.getUTCFullYear();
  const mm = String(utcBase.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utcBase.getUTCDate()).padStart(2, "0");

  const isoish = `${yyyy}-${mm}-${dd}T12:00:00`;

  let dt = new Date(`${isoish}+11:00`);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString();

  dt = new Date(`${isoish}+10:00`);
  return dt.toISOString();
}

/* ---------------- MAIN HANDLER ---------------- */

export async function GET(req: Request) {
  const url = new URL(req.url);

  const secret = url.searchParams.get("secret");
  const season = Number(url.searchParams.get("season") ?? "2026");
  const force = url.searchParams.get("force") === "1";

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!process.env.ODDS_API_KEY) {
    return NextResponse.json({ error: "Missing ODDS_API_KEY" }, { status: 500 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  const { data: comp } = await supabase
    .from("competitions")
    .select("id")
    .limit(1)
    .single();

  if (!comp) {
    return NextResponse.json({ error: "No competition found" }, { status: 404 });
  }

  const { data: rounds } = await supabase
    .from("rounds")
    .select("id, round_number, lock_time_utc, odds_snapshot_for_time_utc, odds_captured_at_utc")
    .eq("competition_id", comp.id)
    .eq("season", season)
    .order("lock_time_utc", { ascending: true });

  const results: any[] = [];
  let processedDueRounds = 0;
  let capturedRounds = 0;

  for (const rr of rounds ?? []) {
    if (!rr.lock_time_utc) continue;

    const snapshotForTimeUtc = computeSnapshotForTimeUtc(rr.lock_time_utc);
    const due = now.getTime() >= new Date(snapshotForTimeUtc).getTime();

    if (!due && !force) {
      results.push({
        round: rr.round_number,
        due: false,
        snapshotForTimeUtc,
        note: "Not due yet",
      });
      continue;
    }

    if (rr.odds_snapshot_for_time_utc === snapshotForTimeUtc) {
      results.push({
        round: rr.round_number,
        due: true,
        snapshotForTimeUtc,
        note: "Already captured",
      });
      continue;
    }

    processedDueRounds++;

    const { data: matches } = await supabase
      .from("matches")
      .select("id, commence_time_utc, home_team, away_team")
      .eq("round_id", rr.id);

    if (!matches?.length) {
      results.push({
        round: rr.round_number,
        due: true,
        snapshotForTimeUtc,
        note: "No matches found",
      });
      continue;
    }

    const times = matches
      .map((m) => new Date(m.commence_time_utc).getTime())
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);

    const fromIso = toOddsApiUtc(new Date(times[0] - 6 * 60 * 60 * 1000).toISOString());
    const toIso = toOddsApiUtc(new Date(times[times.length - 1] + 6 * 60 * 60 * 1000).toISOString());

    const oddsUrl =
      `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds/` +
      `?regions=${REGIONS}` +
      `&markets=${MARKETS}` +
      `&oddsFormat=decimal` +
      `&bookmakers=${BOOKMAKER}` +
      `&commenceTimeFrom=${encodeURIComponent(fromIso)}` +
      `&commenceTimeTo=${encodeURIComponent(toIso)}` +
      `&apiKey=${process.env.ODDS_API_KEY}`;

    const oddsRes = await fetch(oddsUrl, { cache: "no-store" });
    const bodyText = await oddsRes.text();
    const parsed = safeJsonParse(bodyText);

    if (!oddsRes.ok || !Array.isArray(parsed)) {
      results.push({
        round: rr.round_number,
        due: true,
        snapshotForTimeUtc,
        note: "Odds API error or no data",
      });
      continue;
    }

    const events = parsed as OddsApiEvent[];

    let inserted = 0;
    let matched = 0;

    for (const match of matches) {
      const candidates = events.filter((e) =>
        sameMatch(e.home_team, e.away_team, match.home_team, match.away_team)
      );
      if (!candidates.length) continue;

      const best = candidates[0];

      const b = best.bookmakers?.find((x) => x.key === BOOKMAKER);
      const h2h = b?.markets?.find((m) => m.key === "h2h");
      const outcomes = h2h?.outcomes ?? [];

      const homeOutcome = outcomes.find(
        (o) => normTeam(o.name) === normTeam(match.home_team)
      );
      const awayOutcome = outcomes.find(
        (o) => normTeam(o.name) === normTeam(match.away_team)
      );

      if (!homeOutcome || !awayOutcome) continue;

      matched++;

      const { error } = await supabase.from("match_odds").upsert(
        {
          match_id: match.id,
          competition_id: comp.id,
          bookmaker_key: BOOKMAKER,
          market_key: "h2h",
          home_team: match.home_team,
          away_team: match.away_team,
          home_odds: homeOutcome.price,
          away_odds: awayOutcome.price,
          snapshot_for_time_utc: snapshotForTimeUtc,
          captured_at_utc: new Date().toISOString(),
        },
        { onConflict: "match_id,bookmaker_key,market_key,snapshot_for_time_utc" }
      );

      if (!error) inserted++;
    }

    if (inserted > 0) {
      await supabase
        .from("rounds")
        .update({
          odds_snapshot_for_time_utc: snapshotForTimeUtc,
          odds_captured_at_utc: new Date().toISOString(),
        })
        .eq("id", rr.id);

      capturedRounds++;
    }

    results.push({
      round: rr.round_number,
      due: true,
      snapshotForTimeUtc,
      eventsCount: events.length,
      matched,
      inserted,
      note: inserted > 0 ? "Captured" : "No odds available yet",
    });
  }

  return NextResponse.json({
    ok: true,
    season,
    processedDueRounds,
    capturedRounds,
    results,
  });
}