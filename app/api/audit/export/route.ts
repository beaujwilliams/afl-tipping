import { NextResponse } from "next/server";
import { CURRENT_SEASON } from "@/lib/season-config";
import { getBearer, getUserIdFromBearer } from "@/lib/admin-auth";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";
import { createServiceClient } from "@/lib/supabase-server";
import {
  assertMemberAccess,
  buildAuditExportRows,
  getEligibleMemberDirectory,
  getLockedRoundsForSeason,
} from "@/lib/audit-export";

type ExportScope = "all" | "round" | "users";

function csvEscape(value: unknown) {
  const text =
    value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}

function parseUserIds(url: URL) {
  const fromRepeated = url.searchParams
    .getAll("user_id")
    .map((value) => value.trim())
    .filter(Boolean);
  const fromComma = (url.searchParams.get("user_ids") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set([...fromRepeated, ...fromComma]));
}

export async function GET(req: Request) {
  try {
    const token = getBearer(req);
    if (!token) {
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }

    const userId = await getUserIdFromBearer(req);
    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const url = new URL(req.url);
    const seasonRaw = Number(url.searchParams.get("season") ?? CURRENT_SEASON);
    const season = Number.isFinite(seasonRaw)
      ? Math.trunc(seasonRaw)
      : CURRENT_SEASON;
    const scopeRaw = String(url.searchParams.get("scope") ?? "all")
      .trim()
      .toLowerCase();
    const scope: ExportScope =
      scopeRaw === "round" || scopeRaw === "users" ? scopeRaw : "all";
    const roundRaw = url.searchParams.get("round");
    const roundFilter =
      roundRaw !== null && roundRaw !== ""
        ? Math.trunc(Number(roundRaw))
        : null;
    const userFilterIds = parseUserIds(url);
    const explicitCompetitionId = url.searchParams.get("competition_id")?.trim() ?? null;

    if (scope === "round" && (!Number.isFinite(roundFilter) || roundFilter === null || roundFilter < 0)) {
      return NextResponse.json(
        { error: "Provide a valid round number for round export." },
        { status: 400 }
      );
    }

    if (scope === "users" && userFilterIds.length === 0) {
      return NextResponse.json(
        { error: "Select at least one user for user-history export." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const competitionId = await resolveCompetitionIdForSeason({
      season,
      explicitCompetitionId,
      userId,
      supabase,
    });

    if (!competitionId) {
      return NextResponse.json({ error: "No competition found" }, { status: 404 });
    }

    await assertMemberAccess({ supabase, competitionId, userId });

    const [lockedRounds, memberDirectory] = await Promise.all([
      getLockedRoundsForSeason({ supabase, competitionId, season }),
      getEligibleMemberDirectory({ supabase, competitionId }),
    ]);

    const eligibleUserIdSet = new Set(memberDirectory.userIds.map((id) => String(id)));
    const cleanedUserFilterIds = userFilterIds.filter((id) => eligibleUserIdSet.has(id));

    if (scope === "users" && cleanedUserFilterIds.length === 0) {
      return NextResponse.json(
        { error: "None of the selected users are eligible for export." },
        { status: 400 }
      );
    }

    if (scope === "round") {
      const hasRound = lockedRounds.some((round) => round.round_number === roundFilter);
      if (!hasRound) {
        return NextResponse.json(
          { error: "Selected round is not locked yet or does not exist for this season." },
          { status: 400 }
        );
      }
    }

    const exportRows = await buildAuditExportRows({
      supabase,
      competitionId,
      season,
      lockedRounds,
      displayNameByUserId: memberDirectory.displayNameByUserId,
      eligibleUserIds: memberDirectory.userIds,
      roundFilter: scope === "round" ? roundFilter : null,
      userFilterIds: scope === "users" ? cleanedUserFilterIds : undefined,
    });

    const headers =
      scope === "round"
        ? [
            "Member",
            "Match",
            "Final Pick",
            "First Submitted Time",
            "Last Updated Time",
            "Lock Time",
            "After Lock Change",
          ]
        : [
            "Round",
            "Member",
            "Match",
            "Final Pick",
            "First Submitted Time",
            "Last Updated Time",
            "Lock Time",
            "After Lock Change",
          ];

    const csvRows =
      scope === "round"
        ? exportRows.map((row) => ({
            Member: row.member,
            Match: row.match,
            "Final Pick": row.final_pick,
            "First Submitted Time": row.first_submitted_time ?? "",
            "Last Updated Time": row.last_updated_time ?? "",
            "Lock Time": row.lock_time,
            "After Lock Change": row.after_lock_change ? "yes" : "no",
          }))
        : exportRows.map((row) => ({
            Round: row.round,
            Member: row.member,
            Match: row.match,
            "Final Pick": row.final_pick,
            "First Submitted Time": row.first_submitted_time ?? "",
            "Last Updated Time": row.last_updated_time ?? "",
            "Lock Time": row.lock_time,
            "After Lock Change": row.after_lock_change ? "yes" : "no",
          }));

    const fileName =
      scope === "round"
        ? `audit-round-${roundFilter}-season-${season}.csv`
        : scope === "users"
          ? `audit-users-season-${season}.csv`
          : `audit-all-season-${season}.csv`;

    return new NextResponse(toCsv(headers, csvRows), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message === "You are not a member of this competition." ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
