import PeopleAdminClient from "@/components/admin/PeopleAdminClient";
import { CURRENT_SEASON } from "@/lib/season-config";

export default function AdminPeopleSettingsPage() {
  return <PeopleAdminClient mode="settings" season={CURRENT_SEASON} />;
}
