import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import { resolveReigningChampion } from "@/lib/reigning-champion";

const DEFAULT_SEASON = 2026;

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function isMissingTableError(message: string, tableName: string) {
  const m = message.toLowerCase();
  const t = tableName.toLowerCase();
  return m.includes(t) && (m.includes("relation") || m.includes("does not exist") || m.includes("table"));
}

function normalizeUuidList(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function getCompetitionId(
  supabase: ReturnType<typeof createServiceClient>,
  req: Request
) {
  return resolveCompetitionIdForAdminRequest(req, supabase);
}

async function resolvePreviousSeasonChampionCandidate(params: {
  supabase: ReturnType<typeof createServiceClient>;
  competitionId: string;
  season: number;
}) {
  const { supabase, competitionId, season } = params;
  const previousSeason = Number.isFinite(season) ? season - 1 : null;
  let previousSeasonChampionUserId: string | null = null;
  let previousSeasonChampionNotMember = false;

  if (previousSeason !== null) {
    const previousSeasonChampion = await supabase
      .from("season_champions")
      .select("user_id")
      .eq("competition_id", competitionId)
      .eq("season", previousSeason)
      .maybeSingle();

    if (
      previousSeasonChampion.error &&
      !isMissingTableError(previousSeasonChampion.error.message, "season_champions")
    ) {
      throw new Error(
        `Failed to load previous season champion: ${previousSeasonChampion.error.message}`
      );
    }

    const candidateUserId =
      !previousSeasonChampion.error && previousSeasonChampion.data?.user_id
        ? String(previousSeasonChampion.data.user_id)
        : null;

    if (candidateUserId) {
      const memberCheck = await supabase
        .from("memberships")
        .select("user_id")
        .eq("competition_id", competitionId)
        .eq("user_id", candidateUserId)
        .maybeSingle();

      if (memberCheck.error) {
        throw new Error(`Failed to validate previous season champion: ${memberCheck.error.message}`);
      }

      if (memberCheck.data?.user_id) {
        previousSeasonChampionUserId = candidateUserId;
      } else {
        previousSeasonChampionNotMember = true;
      }
    }
  }

  return {
    previousSeason,
    previousSeasonChampionUserId,
    previousSeasonChampionNotMember,
  };
}

export async function GET(req: Request) {
  try {
    const supabase = createServiceClient();
    const competitionId = await getCompetitionId(supabase, req);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const gate = await requireAdminOrCron(req, { competitionId });
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || String(DEFAULT_SEASON));

    const resolved = await resolveReigningChampion({
      competitionId,
      season,
      supabase,
    });

    const previousSeasonCandidate = await resolvePreviousSeasonChampionCandidate({
      supabase,
      competitionId,
      season,
    });

    return NextResponse.json({
      ok: true,
      competition_id: competitionId,
      season,
      previous_season: previousSeasonCandidate.previousSeason,
      previous_season_champion_user_id: previousSeasonCandidate.previousSeasonChampionUserId,
      previous_season_champion_not_member: previousSeasonCandidate.previousSeasonChampionNotMember,
      ...resolved,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Unexpected error", details },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = createServiceClient();
    const competitionId = await getCompetitionId(supabase, req);

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    const gate = await requireAdminOrCron(req, { competitionId });
    if (!gate.ok) return NextResponse.json(gate.json, { status: gate.status });

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || String(DEFAULT_SEASON));

    const body = (await req.json().catch(() => null)) as
      | null
      | {
          reigning_champion_override_user_id?: string | null;
          champion_highlight_user_ids?: unknown;
        };

    if (
      !body ||
      (!("reigning_champion_override_user_id" in body) &&
        !("champion_highlight_user_ids" in body))
    ) {
      return NextResponse.json(
        {
          error:
            "Missing update fields (provide reigning_champion_override_user_id and/or champion_highlight_user_ids)",
        },
        { status: 400 }
      );
    }

    const checkOverrideColumn = await supabase
      .from("competitions")
      .select("reigning_champion_override_user_id")
      .eq("id", competitionId)
      .single();

    if (
      checkOverrideColumn.error &&
      isMissingColumnError(
        checkOverrideColumn.error.message,
        "reigning_champion_override_user_id"
      )
    ) {
      return NextResponse.json(
        {
          error: "Database is missing competitions.reigning_champion_override_user_id",
          hint: "Apply migration db/migrations/20260309_reigning_champion_hybrid.sql",
        },
        { status: 500 }
      );
    }

    if (checkOverrideColumn.error) {
      return NextResponse.json(
        { error: "Failed to read competition", details: checkOverrideColumn.error.message },
        { status: 500 }
      );
    }

    const hasOverrideInput = "reigning_champion_override_user_id" in body;
    const existingOverrideUserId =
      typeof checkOverrideColumn.data?.reigning_champion_override_user_id === "string"
        ? checkOverrideColumn.data.reigning_champion_override_user_id
        : null;
    const overrideUserIdRaw = body.reigning_champion_override_user_id;
    const overrideUserId = hasOverrideInput
      ? typeof overrideUserIdRaw === "string" && overrideUserIdRaw.trim().length
        ? overrideUserIdRaw.trim()
        : null
      : existingOverrideUserId;

    const checkHighlightColumn = await supabase
      .from("competitions")
      .select("champion_highlight_user_ids")
      .eq("id", competitionId)
      .single();

    let highlightColumnAvailable = true;
    let existingHighlightIds: string[] = [];

    if (
      checkHighlightColumn.error &&
      isMissingColumnError(checkHighlightColumn.error.message, "champion_highlight_user_ids")
    ) {
      highlightColumnAvailable = false;
    } else if (checkHighlightColumn.error) {
      return NextResponse.json(
        { error: "Failed to read competition", details: checkHighlightColumn.error.message },
        { status: 500 }
      );
    } else {
      existingHighlightIds = normalizeUuidList(
        checkHighlightColumn.data?.champion_highlight_user_ids
      );
    }

    const hasHighlightsInput = "champion_highlight_user_ids" in body;
    if (hasHighlightsInput && !highlightColumnAvailable) {
      return NextResponse.json(
        {
          error: "Database is missing competitions.champion_highlight_user_ids",
          hint: "Apply migration db/migrations/20260401_competition_champion_highlights.sql",
        },
        { status: 500 }
      );
    }

    let championHighlightUserIds = existingHighlightIds;
    if (hasHighlightsInput) {
      const raw = body.champion_highlight_user_ids;
      if (raw === null) {
        championHighlightUserIds = [];
      } else if (!Array.isArray(raw)) {
        return NextResponse.json(
          { error: "champion_highlight_user_ids must be an array of user ids" },
          { status: 400 }
        );
      } else {
        const hasInvalid = raw.some((item) => typeof item !== "string");
        if (hasInvalid) {
          return NextResponse.json(
            { error: "champion_highlight_user_ids must contain only string user ids" },
            { status: 400 }
          );
        }
        championHighlightUserIds = normalizeUuidList(raw);
      }
    }

    const idsToValidate = Array.from(
      new Set(
        [overrideUserId, ...championHighlightUserIds]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      )
    );

    if (idsToValidate.length > 0) {
      const { data: memberRows, error: memErr } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("competition_id", competitionId)
        .in("user_id", idsToValidate);

      if (memErr) {
        return NextResponse.json(
          { error: "Failed to validate member", details: memErr.message },
          { status: 500 }
        );
      }

      const validIds = new Set((memberRows ?? []).map((row) => String(row.user_id)));

      if (overrideUserId && !validIds.has(overrideUserId)) {
        return NextResponse.json(
          { error: "Champion override must be an existing competition member" },
          { status: 400 }
        );
      }

      const invalidHighlightIds = championHighlightUserIds.filter((id) => !validIds.has(id));
      if (invalidHighlightIds.length > 0) {
        return NextResponse.json(
          {
            error:
              "Champion highlight list must contain only existing competition members",
            details: `Invalid user ids: ${invalidHighlightIds.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    const updatePayload: {
      reigning_champion_override_user_id: string | null;
      champion_highlight_user_ids?: string[];
    } = {
      reigning_champion_override_user_id: overrideUserId,
    };
    if (highlightColumnAvailable) {
      updatePayload.champion_highlight_user_ids = championHighlightUserIds;
    }

    const { error: updateErr } = await supabase
      .from("competitions")
      .update(updatePayload)
      .eq("id", competitionId);

    if (updateErr) {
      return NextResponse.json(
        { error: "Failed to save champion override", details: updateErr.message },
        { status: 500 }
      );
    }

    const resolved = await resolveReigningChampion({
      competitionId,
      season,
      supabase,
    });

    const previousSeasonCandidate = await resolvePreviousSeasonChampionCandidate({
      supabase,
      competitionId,
      season,
    });

    return NextResponse.json({
      ok: true,
      competition_id: competitionId,
      season,
      previous_season: previousSeasonCandidate.previousSeason,
      previous_season_champion_user_id: previousSeasonCandidate.previousSeasonChampionUserId,
      previous_season_champion_not_member: previousSeasonCandidate.previousSeasonChampionNotMember,
      ...resolved,
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Unexpected error", details },
      { status: 500 }
    );
  }
}
