import PeopleAdminClient from "@/components/admin/PeopleAdminClient";
import { CURRENT_SEASON } from "@/lib/season-config";

type AdminRosterPageProps = {
  params: Promise<{
    season: string;
  }>;
};

export default async function AdminRosterPage(props: AdminRosterPageProps) {
  const { season: seasonParam } = await props.params;
  const seasonNumber = Number(seasonParam);
  const season =
    Number.isFinite(seasonNumber) && seasonNumber >= 2000 && seasonNumber <= 2100
      ? Math.trunc(seasonNumber)
      : CURRENT_SEASON;

  return <PeopleAdminClient mode="roster" season={season} />;
}
