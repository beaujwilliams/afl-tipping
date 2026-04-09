import Link from "next/link";
import { redirect } from "next/navigation";
import { UiBadge, UiCard, UiSectionHeader } from "@/components/ui";
import { resolveCompetitionIdForSeason } from "@/lib/competition-resolver";
import { getRoundDisplayName } from "@/lib/round-label";
import { getRoundTipStatusResponse } from "@/lib/round-tip-status-data";
import { createClient, createServiceClient } from "@/lib/supabase-server";

type SeasonResultsPageProps = {
  params: Promise<{
    season: string;
  }>;
};

function melbourneMs(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function fmtMelbourneShort(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function roundStatusTone(total: number, finished: number, locked: boolean) {
  if (total > 0 && finished === total) return "success" as const;
  if (locked) return "warning" as const;
  return "info" as const;
}

function roundStatusLabel(total: number, finished: number, locked: boolean) {
  if (total > 0 && finished === total) return "COMPLETE";
  if (locked) return "IN PROGRESS";
  return "NOT STARTED";
}

function getNowMs() {
  return Date.now();
}

export default async function SeasonResultsPage(props: SeasonResultsPageProps) {
  const { season: seasonParam } = await props.params;
  const season = Number(seasonParam);

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let rows = [] as Awaited<ReturnType<typeof getRoundTipStatusResponse>>["rounds"];
  let msg = "";

  if (!Number.isFinite(season)) {
    msg = "Invalid season.";
  } else {
    try {
      const supabase = createServiceClient();
      const competitionId = await resolveCompetitionIdForSeason({
        season,
        userId: user.id,
        supabase,
      });

      if (!competitionId) {
        msg = "No competition found.";
      } else {
        const response = await getRoundTipStatusResponse({
          competitionId,
          season,
          userId: user.id,
          admin: false,
          supabase,
        });
        rows = response.rounds;
      }
    } catch (error) {
      msg = error instanceof Error ? error.message : "Could not load rounds.";
    }
  }

  const nowMs = getNowMs();
  const visibleRows = rows
    .filter((row) => {
      const lock = melbourneMs(row.lock_time_utc);
      return lock ? nowMs >= lock : false;
    })
    .sort((a, b) => b.round_number - a.round_number);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <main className="ui-page ui-page--narrow">
      <UiSectionHeader
        title={`Round Results • ${season}`}
        subtitle="All times shown in Melbourne"
      />

      {!!msg && <p className="ui-caption ui-mt-4">{msg}</p>}

      {!msg && rows.length === 0 && <div className="ui-caption ui-mt-4">No rounds found.</div>}
      {!msg && rows.length > 0 && visibleRows.length === 0 && (
        <div className="ui-caption ui-mt-4">
          No round results are visible yet. Results appear once each round locks.
        </div>
      )}
      {!msg && hiddenCount > 0 && visibleRows.length > 0 && (
        <div className="ui-caption ui-mt-3">
          {hiddenCount} future round{hiddenCount === 1 ? "" : "s"} hidden until lock time.
        </div>
      )}

      {!msg && visibleRows.length > 0 && (
        <div className="ui-grid ui-mt-4">
          {visibleRows.map((row) => {
            const lock = melbourneMs(row.lock_time_utc);
            const locked = lock ? nowMs >= lock : false;

            return (
              <Link
                key={row.round_id}
                href={`/results/${season}/${row.round_number}`}
                style={{ WebkitTapHighlightColor: "transparent" }}
              >
                <UiCard soft className="ui-row-between" style={{ minHeight: 68, padding: "14px 14px" }}>
                  <div className="ui-grid" style={{ gap: 6 }}>
                    <div style={{ fontWeight: 950, fontSize: 18, letterSpacing: -0.2 }}>
                      {getRoundDisplayName(row.round_number)}
                    </div>

                    <div style={{ opacity: 0.75, fontSize: 12 }}>
                      Locked: <span style={{ opacity: 0.95 }}>{fmtMelbourneShort(row.lock_time_utc)}</span>
                    </div>

                    <div style={{ opacity: 0.8, fontSize: 12 }}>
                      Finished matches: <b>{row.completed_matches}</b>/<b>{row.total_matches}</b>
                    </div>
                  </div>

                  <UiBadge tone={roundStatusTone(row.total_matches, row.completed_matches, locked)}>
                    {roundStatusLabel(row.total_matches, row.completed_matches, locked)}
                  </UiBadge>
                </UiCard>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
