import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

const SEASON = 2026;

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
  date?: string;      // sometimes parseable/UTC-ish
  localtime?: string; // often "YYYY-MM-DD HH:mm:ss" without tz

  venue?: string;

  complete?: number;
  winnerteamid?: number;
  winner?: string;
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

function pickCommenceTimeUtc(g: SquiggleGame) {
  // 1) If Squiggle provides a usable "date", prefer it
  if (g.date) {
    const d = new Date(g.date);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // 2) Otherwise convert localtime (Melbourne) -> UTC
  if (g.localtime) {
    return localtimeToUtcIso(g.localtime);
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
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();

  const { data: comp, error: cErr } = await supabase
    .from("competitions")
    .select("id")
    .limit(1)
    .single();

  if (cErr || !comp) {
    return NextResponse.json({ error: "No competition found" }, { status: 409 });
  }

  const gamesUrl = `https://api.squiggle.com.au/?q=games;year=${SEASON};format=json`;
  const teamsUrl = `https://api.squiggle.com.au/?q=teams;year=${SEASON};format=json`;

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
          competition_id: comp.id,
          season: SEASON,
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
        };
      })
      .filter(Boolean);

    if (!matchRows.length) {
      skippedGames += roundGames.length;
      continue;
    }

    const { error: mErr } = await supabase
      .from("matches")
      .upsert(matchRows as any[], { onConflict: "squiggle_game_id" });

    if (mErr) {
      console.log("Match upsert error:", mErr);
      skippedGames += matchRows.length;
      continue;
    }

    matchesUpserted += matchRows.length;
  }

  return NextResponse.json({
    ok: true,
    season: SEASON,
    roundsUpserted,
    matchesUpserted,
    skippedGames,
  });
}