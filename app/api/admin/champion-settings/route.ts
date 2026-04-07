import { NextResponse } from "next/server";
import {
  describeChampionSeasonAuditChanges,
  recordAdminAuditEvent,
} from "@/lib/admin-audit";
import { createServiceClient } from "@/lib/supabase-server";
import { requireAdminOrCron, resolveCompetitionIdForAdminRequest } from "@/lib/admin-auth";
import { resolveReigningChampion } from "@/lib/reigning-champion";
import { normalizeSeasonChampionSelections } from "@/lib/champion-metadata";
import { loadSeasonChampions } from "@/lib/season-champions";

const DEFAULT_SEASON = 2026;

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

async function getCompetitionId(
  supabase: ReturnType<typeof createServiceClient>,
  req: Request
) {
  return resolveCompetitionIdForAdminRequest(req, supabase);
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
    const seasonChampionSettings = await loadSeasonChampions({
      supabase,
      competitionId,
    });

    if (!seasonChampionSettings.tableAvailable) {
      return NextResponse.json(
        {
          error: "Database is missing season_champions",
          hint: "Apply migration db/migrations/20260309_reigning_champion_hybrid.sql",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      competition_id: competitionId,
      season,
      season_champions: seasonChampionSettings.rows,
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
    const actorUserId = gate.mode === "bearer" ? gate.userId : null;

    const url = new URL(req.url);
    const season = Number(url.searchParams.get("season") || String(DEFAULT_SEASON));

    const body = (await req.json().catch(() => null)) as
      | null
      | {
          season_champions?: unknown;
        };

    if (!body || !("season_champions" in body)) {
      return NextResponse.json(
        {
          error: "Missing update fields (provide season_champions)",
        },
        { status: 400 }
      );
    }

    const hasSeasonChampionsInput = "season_champions" in body;

    const checkHighlightColumn = await supabase
      .from("competitions")
      .select("champion_highlight_user_ids")
      .eq("id", competitionId)
      .single();

    const highlightColumnAvailable = !checkHighlightColumn.error;

    if (
      checkHighlightColumn.error &&
      !isMissingColumnError(checkHighlightColumn.error.message, "champion_highlight_user_ids")
    ) {
      return NextResponse.json(
        { error: "Failed to read competition", details: checkHighlightColumn.error.message },
        { status: 500 }
      );
    }

    const seasonChampionSettings = await loadSeasonChampions({
      competitionId,
      supabase,
    });

    if (hasSeasonChampionsInput && !seasonChampionSettings.tableAvailable) {
      return NextResponse.json(
        {
          error: "Database is missing season_champions",
          hint: "Apply migration db/migrations/20260309_reigning_champion_hybrid.sql",
        },
        { status: 500 }
      );
    }

    let seasonChampionSelections = seasonChampionSettings.rows;
    if (hasSeasonChampionsInput) {
      const raw = body.season_champions;
      if (raw !== null && raw !== undefined && !Array.isArray(raw)) {
        return NextResponse.json(
          { error: "season_champions must be an array of season winner rows" },
          { status: 400 }
        );
      }
      seasonChampionSelections = normalizeSeasonChampionSelections(raw);
    }

    const idsToValidate = Array.from(
      new Set(
        seasonChampionSelections
          .map((entry) => entry?.user_id ?? null)
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
      const invalidSeasonChampionIds = seasonChampionSelections
        .map((entry) => entry?.user_id ?? null)
        .filter((userId): userId is string => !!userId && !validIds.has(userId));
      if (invalidSeasonChampionIds.length > 0) {
        return NextResponse.json(
          {
            error: "Season winners must be existing competition members",
            details: `Invalid user ids: ${invalidSeasonChampionIds.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    const updatePayload: {
      champion_highlight_user_ids?: string[];
    } = {};
    if (highlightColumnAvailable && hasSeasonChampionsInput) {
      updatePayload.champion_highlight_user_ids = [];
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateErr } = await supabase
        .from("competitions")
        .update(updatePayload)
        .eq("id", competitionId);

      if (updateErr) {
        return NextResponse.json(
          { error: "Failed to save champion settings", details: updateErr.message },
          { status: 500 }
        );
      }
    }

    if (hasSeasonChampionsInput) {
      const rowsToUpsert = seasonChampionSelections
        .filter(
          (entry): entry is { season: number; user_id: string } => !!entry?.user_id
        )
        .map((entry) => ({
          competition_id: competitionId,
          season: entry.season,
          user_id: entry.user_id,
          source: "manual",
        }));

      if (rowsToUpsert.length > 0) {
        const { error: upsertErr } = await supabase.from("season_champions").upsert(
          rowsToUpsert,
          { onConflict: "competition_id,season" }
        );

        if (upsertErr) {
          return NextResponse.json(
            { error: "Failed to save season winners", details: upsertErr.message },
            { status: 500 }
          );
        }
      }

      const seasonsToDelete = seasonChampionSelections
        .filter((entry) => !entry?.user_id)
        .map((entry) => entry?.season)
        .filter((season): season is number => Number.isFinite(season));

      if (seasonsToDelete.length > 0) {
        const { error: deleteErr } = await supabase
          .from("season_champions")
          .delete()
          .eq("competition_id", competitionId)
          .in("season", seasonsToDelete);

        if (deleteErr) {
          return NextResponse.json(
            { error: "Failed to clear season winners", details: deleteErr.message },
            { status: 500 }
          );
        }
      }
    }

    const resolved = await resolveReigningChampion({
      competitionId,
      season,
      supabase,
    });
    const refreshedSeasonChampions = await loadSeasonChampions({
      supabase,
      competitionId,
    });

    if (!refreshedSeasonChampions.tableAvailable) {
      return NextResponse.json(
        {
          error: "Database is missing season_champions",
          hint: "Apply migration db/migrations/20260309_reigning_champion_hybrid.sql",
        },
        { status: 500 }
      );
    }

    const championChanges = describeChampionSeasonAuditChanges({
      before: seasonChampionSettings.rows,
      after: refreshedSeasonChampions.rows,
    });
    const auditError = await recordAdminAuditEvent({
      competitionId,
      season,
      actionType: "champion_settings_updated",
      actorMode: gate.mode,
      actorUserId,
      targetType: "competition",
      targetLabel: "Season winners",
      summary:
        championChanges.length > 0
          ? `Updated season winners: ${championChanges.join(", ")}.`
          : "Saved season winners without changes.",
      requestPath: url.pathname + url.search,
      details: {
        before: seasonChampionSettings.rows,
        after: refreshedSeasonChampions.rows,
        changed_seasons: championChanges,
      },
    });
    if (auditError) {
      console.warn("admin audit log failed after champion settings update", auditError);
    }

    return NextResponse.json({
      ok: true,
      competition_id: competitionId,
      season,
      season_champions: refreshedSeasonChampions.rows,
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
