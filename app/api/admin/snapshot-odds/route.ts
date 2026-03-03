import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-server";

const ADMIN_EMAIL = "beau.j.williams@gmail.com";

const SPORT_KEY = "aussierules_afl";
const REGIONS = "au";
const MARKETS = "h2h";
const BOOKMAKER = "sportsbet";

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

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function allowBearerOrCron(req: Request): Promise<{
  ok: boolean;
  mode?: "cron" | "bearer";
  token?: string;
  secret?: string;
}> {
  const url = new URL(req.url);

  // ✅ Cron secret mode
  const secret = url.searchParams.get("secret") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && secret && secret === cronSecret) {
    return { ok: true, mode: "cron", secret };
  }

  // ✅ Bearer mode (admin UI)
  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return { ok: false };

  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false };

  const authClient = createClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data } = await authClient.auth.getUser(token);
  if ((data.user?.email ?? "") !== ADMIN_EMAIL) return { ok: false };

  return { ok: true, mode: "bearer", token };
}

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

/* ---------------- SNAPSHOT TIME ---------------- */
/**
 * Snapshot time = 12:00pm Melbourne time the day BEFORE the first match of the round.
 * We take the round lock_time_utc (first match start) and compute "previous day at noon Melbourne".
 */
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

/* ---------------- HELPERS ---------------- */

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Odds API wants YYYY-MM-DDTHH:MM:SSZ (no milliseconds)
function toOddsApiUtc(isoWithMs: string) {
  return isoWithMs.replace(/\.\d{3}Z$/, "Z");
}

/* ---------------- MAIN HANDLER ---------------- */

export async function GET(req: Request) {
  try {
    const gate = await allowBearerOrCron(req);
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const secret = url.searchParams.get("secret");
    const season = Number(url.searchParams.get("season"));
    const round = Number(url.searchParams.get("round"));

    // cron mode validation (bearer mode doesn't need secret param)
    if (gate.mode === "cron") {
      if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (!process.env.ODDS_API_KEY) {
      return NextResponse.json({ error: "Missing ODDS_API_KEY" }, { status: 500 });
    }

    if (!season || Number.isNaN(season) || Number.isNaN(round)) {
      return NextResponse.json({ error: "Provide season and round" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // single-comp MVP
    const { data: comp } = await supabase
      .from("competitions")
      .select("id")
      .limit(1)
      .single();

    if (!comp) return NextResponse.json({ error: "No competition" }, { status: 404 });

    const { data: roundRow } = await supabase
      .from("rounds")
      .select("id, lock_time_utc")
      .eq("competition_id", comp.id)
      .eq("season", season)
      .eq("round_number", round)
      .single();

    if (!roundRow) return NextResponse.json({ error: "Round not found" }, { status: 404 });

    const snapshotForTimeUtc = computeSnapshotForTimeUtc(roundRow.lock_time_utc);

    const { data: matches } = await supabase
      .from("matches")
      .select("id, commence_time_utc, home_team, away_team")
      .eq("round_id", roundRow.id);

    if (!matches?.length) {
      return NextResponse.json({ error: "No matches found" }, { status: 404 });
    }

    // date window (UTC) around match times
    const times = matches
      .map((m) => new Date(m.commence_time_utc).getTime())
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);

    const fromIso = new Date(times[0] - 6 * 60 * 60 * 1000).toISOString();
    const toIso = new Date(times[times.length - 1] + 6 * 60 * 60 * 1000).toISOString();

    const commenceTimeFrom = toOddsApiUtc(fromIso);
    const commenceTimeTo = toOddsApiUtc(toIso);

    const oddsUrl =
      `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds/` +
      `?regions=${REGIONS}` +
      `&markets=${MARKETS}` +
      `&oddsFormat=decimal` +
      `&bookmakers=${BOOKMAKER}` +
      `&commenceTimeFrom=${encodeURIComponent(commenceTimeFrom)}` +
      `&commenceTimeTo=${encodeURIComponent(commenceTimeTo)}` +
      `&apiKey=${process.env.ODDS_API_KEY}`;

    const oddsRes = await fetch(oddsUrl, { cache: "no-store" });
    const bodyText = await oddsRes.text();
    const parsed = safeJsonParse(bodyText);

    if (!oddsRes.ok) {
      return NextResponse.json(
        {
          error: "Odds API request failed",
          status: oddsRes.status,
          bodyHead: bodyText.slice(0, 220),
          window: { commenceTimeFrom, commenceTimeTo },
        },
        { status: 502 }
      );
    }

    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        {
          error: "Odds API returned non-array JSON (likely an error payload).",
          status: oddsRes.status,
          bodyHead: bodyText.slice(0, 220),
          window: { commenceTimeFrom, commenceTimeTo },
        },
        { status: 502 }
      );
    }

    const events = parsed as OddsApiEvent[];

    let inserted = 0;
    let matched = 0;

    for (const match of matches) {
      const candidates = events.filter((e) =>
        sameMatch(e.home_team, e.away_team, match.home_team, match.away_team)
      );
      if (!candidates.length) continue;

      // choose closest commence_time
      const targetTime = new Date(match.commence_time_utc).getTime();
      const best = candidates
        .map((e) => ({
          e,
          diff: Math.abs(new Date(e.commence_time).getTime() - targetTime),
        }))
        .sort((a, b) => a.diff - b.diff)[0].e;

      const sportsbet = best.bookmakers?.find((b) => b.key === BOOKMAKER);
      const h2h = sportsbet?.markets?.find((m) => m.key === "h2h");
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

    return NextResponse.json({
      ok: true,
      season,
      round,
      snapshotForTimeUtc,
      matches: matches.length,
      eventsCount: events.length,
      matched,
      inserted,
      bookmaker: BOOKMAKER,
      window: { commenceTimeFrom, commenceTimeTo },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Unexpected error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}