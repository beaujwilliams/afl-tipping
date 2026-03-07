import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isValidAflTeam } from "@/lib/afl-teams";
import { createClient, createServiceClient } from "@/lib/supabase-server";
import { getBearer } from "@/lib/admin-auth";

type ProfileRowWithFavorite = {
  id: string;
  display_name: string | null;
  favorite_team: string | null;
};

type ProfileRowWithoutFavorite = {
  id: string;
  display_name: string | null;
};

type ProfilePayload = {
  display_name: string | null;
  favorite_team: string | null;
};

const FAVORITE_TEAM_COLUMN = "favorite_team";

function isMissingColumnError(message: string, columnName: string) {
  const m = message.toLowerCase();
  const col = columnName.toLowerCase();
  return m.includes(col) && (m.includes("column") || m.includes("does not exist"));
}

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

async function getUserFromBearer(req: Request) {
  const token = getBearer(req);
  if (!token) return null;

  const authClient = createSupabaseClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function getAuthedUser(req: Request) {
  const fromBearer = await getUserFromBearer(req);
  if (fromBearer) return fromBearer;

  const authClient = await createClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

async function readProfileByUserId(
  service: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<{ profile: ProfilePayload; favoriteColumnAvailable: boolean }> {
  const withFavorite = await service
    .from("profiles")
    .select("id, display_name, favorite_team")
    .eq("id", userId)
    .maybeSingle();

  if (!withFavorite.error) {
    const row = (withFavorite.data as ProfileRowWithFavorite | null) ?? null;
    return {
      profile: {
        display_name: row?.display_name ?? null,
        favorite_team: row?.favorite_team ?? null,
      },
      favoriteColumnAvailable: true,
    };
  }

  if (!isMissingColumnError(withFavorite.error.message, FAVORITE_TEAM_COLUMN)) {
    throw new Error(withFavorite.error.message);
  }

  const fallback = await service
    .from("profiles")
    .select("id, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  const row = (fallback.data as ProfileRowWithoutFavorite | null) ?? null;
  return {
    profile: {
      display_name: row?.display_name ?? null,
      favorite_team: null,
    },
    favoriteColumnAvailable: false,
  };
}

export async function GET(req: Request) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const service = createServiceClient();
    const { profile } = await readProfileByUserId(service, user.id);

    return NextResponse.json({
      ok: true,
      profile: {
        email: user.email ?? null,
        display_name: profile.display_name,
        favorite_team: profile.favorite_team,
      },
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "Failed to read profile", details }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as null | {
      display_name?: string;
      favorite_team?: string | null;
    };

    const hasDisplayName = typeof body?.display_name === "string";
    const hasFavoriteTeam = !!body && Object.prototype.hasOwnProperty.call(body, "favorite_team");

    if (!hasDisplayName && !hasFavoriteTeam) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const service = createServiceClient();

    if (hasDisplayName) {
      const displayName = body?.display_name?.trim() ?? "";
      const { error } = await service.from("profiles").upsert(
        {
          id: user.id,
          display_name: displayName.length ? displayName : null,
        },
        { onConflict: "id" }
      );

      if (error) {
        return NextResponse.json(
          { error: "Failed to save display name", details: error.message },
          { status: 500 }
        );
      }
    }

    if (hasFavoriteTeam) {
      const rawFavorite = body?.favorite_team;
      if (rawFavorite !== null && rawFavorite !== undefined && typeof rawFavorite !== "string") {
        return NextResponse.json({ error: "Invalid favorite_team" }, { status: 400 });
      }

      const favoriteTeam =
        typeof rawFavorite === "string" ? rawFavorite.trim() || null : null;

      if (favoriteTeam && !isValidAflTeam(favoriteTeam)) {
        return NextResponse.json({ error: "Invalid favorite team selection" }, { status: 400 });
      }

      const { error } = await service.from("profiles").upsert(
        {
          id: user.id,
          favorite_team: favoriteTeam,
        },
        { onConflict: "id" }
      );

      if (error) {
        if (isMissingColumnError(error.message, FAVORITE_TEAM_COLUMN)) {
          return NextResponse.json(
            {
              error: "Database is missing favorite_team column",
              details:
                "Run db/migrations/20260307_profiles_favorite_team.sql and redeploy.",
            },
            { status: 500 }
          );
        }

        return NextResponse.json(
          { error: "Failed to save favorite team", details: error.message },
          { status: 500 }
        );
      }
    }

    const { profile } = await readProfileByUserId(service, user.id);

    return NextResponse.json({
      ok: true,
      profile: {
        email: user.email ?? null,
        display_name: profile.display_name,
        favorite_team: profile.favorite_team,
      },
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update profile", details }, { status: 500 });
  }
}
