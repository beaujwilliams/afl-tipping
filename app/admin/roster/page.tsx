import { redirect } from "next/navigation";
import { CURRENT_SEASON } from "@/lib/season-config";

export default function AdminRosterIndexPage() {
  redirect(`/admin/roster/${CURRENT_SEASON}`);
}
