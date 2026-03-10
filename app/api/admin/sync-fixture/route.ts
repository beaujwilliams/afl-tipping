import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getDefaultCompetitionId, requireAdminOrCron } from "@/lib/admin-auth";

type SquiggleTeam = {
  id?: number;
  name?: string;
};

type SquiggleGame = {
  id?: number;
  game?: number;
  round?: number;
  year?: number;

  // Squiggle game payload commonly uses these:
  hteamid?: number;
  ateamid?: number;

  // Sometimes present too:
  hteam?: string;
  ateam?: string;

  // Time
  unixtime?: number | string;
  date?: string;      // sometimes parseable/UTC-ish
  localtime?: string; // often "YYYY-MM-DD HH:mm:ss" without tz
  timestr?: string;   // can include explicit timezone
  tz?: string;

  venue?: string;

  complete?: number;
  winnerteamid?: number;
  winner?: string;
};

type MatchUpsertRow = {
  round_id: string;
  squiggle_game_id: number;
  commence_time_utc: string;
  home_team: string;
  away_team: string;
  venue: string | null;
  status: string;
  winner_team: string | null;
};

function pickGameId(g: SquiggleGame) {
  return g.id ?? g.game ?? null;
}

// Compute Melbourne DST offset (+11 during DST, else +10)
// DST: first Sunday in Oct -> first Sunday in Apr
function melbourneOffsetForLocalDate(yyyy: number, mm: number, dd: number) {
  function firstSunday(year: number, month1to12: number) {
    const d = new Date(Date.UTC(year, month1to12 - 1, 1));
    const day = d.getUTCDay(); // 0=Sun
    const delta = (7 - day) % 7;
    return 1 + delta;
  }

  const dstStartDay = firstSunday(yyyy, 10); // Oct
  const dstEndDay = firstSunday(yyyy, 4);    // Apr

  const afterStart =
    mm > 10 || (mm === 10 && dd >= dstStartDay);
  const beforeEnd =
    mm < 4 || (mm === 4 && dd < dstEndDay);

  const inDst = afterStart || beforeEnd;
  return inDst ? "+11:00" : "+10:00";
}

function localtimeToUtcIso(localtime: string) {
  // expects "YYYY-MM-DD HH:mm:ss"
  const isoish = localtime.replace(" ", "T");
  const m = isoish.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!m) return null;

  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);

  const offset = melbourneOffsetForLocalDate(yyyy, mm, dd);
  const d = new Date(`${isoish}${offset}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function hasExplicitTimezone(raw: string) {
  const s = raw.trim();
  if (/z$/i.test(s)) return true;
  if (/[+-]\d{2}:\d{2}$/.test(s)) return true;
  if (/[+-]\d{4}$/.test(s)) return true;
  return false;
}

function naiveDateTimeToUtcIso(raw: string) {
  const s = raw.trim().replace("T", " ");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const hh = m[4];
  const min = m[5];
  const ss = m[6] ?? "00";
  return localtimeToUtcIso(`${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")} ${hh}:${min}:${ss}`);
}

function unixtimeToUtcIso(unixtime: number | string | undefined) {
  if (unixtime === undefined || unixtime === null) return null;
  const value = Number(unixtime);
  if (!Number.isFinite(value) || value <= 0) return null;
  const ms = value > 1e12 ? value : value * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function pickCommenceTimeUtc(g: SquiggleGame) {
  // 1) Most reliable: unix timestamp from Squiggle.
  const byUnix = unixtimeToUtcIso(g.unixtime);
  if (byUnix) return byUnix;

  // 2) If date/timestr has an explicit timezone, parse directly.
  if (g.date && hasExplicitTimezone(g.date)) {
    const d = new Date(g.date);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (g.timestr && hasExplicitTimezone(g.timestr)) {
    const d = new Date(g.timestr);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // 3) Convert known local (Melbourne) formats.
  if (g.localtime) {
    return localtimeToUtcIso(g.localtime);
  }
  if (g.date) {
    const fromNaiveDate = naiveDateTimeToUtcIso(g.date);
    if (fromNaiveDate) return fromNaiveDate;
  }

  return null;
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "afl-tipping-dev/1.0" },
  });
  const text = await res.text();
  const json = JSON.parse(text);
  return { res, json };
}

export async function GET(req: Request) {
  const gate = await requireAdminOrCron(req);
  if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season") || String(new Date().getFullYear()));
  if (!Number.isFinite(season) || season < 2000 || season > 2100) {
    return NextResponse.json({ error: "Provide a valid season" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const competitionId =
    gate.mode === "bearer" ? gate.competitionId : await getDefaultCompetitionId(supabase);
  if (!competitionId) {
    return NextResponse.json({ error: "No competition found" }, { status: 404 });
  }

  const gamesUrl = `https://api.squiggle.com.au/?q=games;year=${season};format=json`;
  const teamsUrl = `https://api.squiggle.com.au/?q=teams;year=${season};format=json`;

  const { json: gamesJson } = await fetchJson(gamesUrl);
  const { json: teamsJson } = await fetchJson(teamsUrl);

  const games: SquiggleGame[] = Array.isArray(gamesJson?.games) ? gamesJson.games : [];
  const teams: SquiggleTeam[] = Array.isArray(teamsJson?.teams) ? teamsJson.teams : [];

  const teamNameById = new Map<number, string>();
  for (const t of teams) {
    if (typeof t.id === "number" && t.name) teamNameById.set(t.id, t.name);
  }

  // Group games by round
  const roundsMap = new Map<number, SquiggleGame[]>();
  for (const g of games) {
    const r = Number(g.round ?? 0);
    const arr = roundsMap.get(r) ?? [];
    arr.push(g);
    roundsMap.set(r, arr);
  }

  let roundsUpserted = 0;
  let matchesUpserted = 0;
  let skippedGames = 0;

  for (const [roundNumber, roundGames] of roundsMap.entries()) {
    const times = roundGames
      .map(pickCommenceTimeUtc)
      .filter(Boolean)
      .map((t) => new Date(t as string))
      .sort((a, b) => a.getTime() - b.getTime());

    if (!times.length) {
      skippedGames += roundGames.length;
      continue;
    }

    const firstMatchTimeUtc = times[0].toISOString();

    const { data: roundRow, error: rErr } = await supabase
      .from("rounds")
      .upsert(
        {
          competition_id: competitionId,
          season,
          round_number: roundNumber,
          first_match_time_utc: firstMatchTimeUtc,
          lock_time_utc: firstMatchTimeUtc,
        },
        { onConflict: "competition_id,season,round_number" }
      )
      .select("id")
      .single();

    if (rErr || !roundRow) {
      skippedGames += roundGames.length;
      continue;
    }

    roundsUpserted++;

    const matchRows = roundGames
      .map((g) => {
        const gameId = pickGameId(g);
        const commence = pickCommenceTimeUtc(g);
        if (!gameId || !commence) return null;

        const home =
          typeof g.hteamid === "number"
            ? teamNameById.get(g.hteamid)
            : g.hteam;
        const away =
          typeof g.ateamid === "number"
            ? teamNameById.get(g.ateamid)
            : g.ateam;

        if (!home || !away) return null;

        const status =
          g.complete === 100 || g.winner || g.winnerteamid
            ? "final"
            : (g.complete ?? 0) > 0
            ? "live"
            : "scheduled";

        const winnerTeam =
          typeof g.winnerteamid === "number"
            ? teamNameById.get(g.winnerteamid) ?? null
            : g.winner ?? null;

        return {
          round_id: roundRow.id,
          squiggle_game_id: gameId,
          commence_time_utc: commence,
          home_team: home,
          away_team: away,
          venue: g.venue ?? null,
          status,
          winner_team: winnerTeam,
        } satisfies MatchUpsertRow;
      })
      .filter((row): row is MatchUpsertRow => row !== null);

    if (!matchRows.length) {
      skippedGames += roundGames.length;
      continue;
    }

    const { error: mErr } = await supabase
      .from("matches")
      .upsert(matchRows, { onConflict: "squiggle_game_id" });

    if (mErr) {
      console.log("Match upsert error:", mErr);
      skippedGames += matchRows.length;
      continue;
    }

    matchesUpserted += matchRows.length;
  }

  return NextResponse.json({
    ok: true,
    season,
    competition_id: competitionId,
    roundsUpserted,
    matchesUpserted,
    skippedGames,
  });
}
