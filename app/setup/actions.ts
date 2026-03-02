"use server";

import { createClient } from "@/lib/supabase-server";

function makeJoinCode() {
  return "NEEDLESSLY";
}

export async function ensureCompetition() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not logged in");

  // Single-comp MVP: if one exists, use it
  const { data: existing } = await supabase
    .from("competitions")
    .select("id, join_code")
    .limit(1);

  if (existing && existing.length > 0) {
    return { competitionId: existing[0].id, joinCode: existing[0].join_code };
  }

  // Create comp
  const { data: comp, error: cErr } = await supabase
    .from("competitions")
    .insert({
      name: "Needlessly Complicated AFL Tipping",
      join_code: makeJoinCode(),
      owner_user_id: auth.user.id,
    })
    .select("id, join_code")
    .single();

  if (cErr) throw new Error(cErr.message);

  // Owner membership
  const { error: mErr } = await supabase.from("memberships").insert({
    competition_id: comp.id,
    user_id: auth.user.id,
    role: "owner",
  });

  if (mErr) throw new Error(mErr.message);

  return { competitionId: comp.id, joinCode: comp.join_code };
}