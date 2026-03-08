import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isValidAflTeam } from "@/lib/afl-teams";
import { isDuplicateUsernameError, validateUsername } from "@/lib/username";
import { createClient, createServiceClient } from "@/lib/supabase-server";
import { getBearer } from "@/lib/admin-auth";

type ProfileRowWithFavorite = {
  id: string;
  display_name: string | null;
  favorite_team: string | null;
  username: string | null;
};

type ProfileRowWithoutFavorite = {
  id: string;
  display_name: string | null;
  username: string | null;
};

type ProfilePayload = {
  display_name: string | null;
  favorite_team: string | null;
  username: string | null;
};

const FAVORITE_TEAM_COLUMN = "favorite_team";
const USERNAME_COLUMN = "username";

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
): Promise<{
  profile: ProfilePayload;
  favoriteColumnAvailable: boolean;
  usernameColumnAvailable: boolean;
}> {
  const full = await service
    .from("profiles")
    .select("id, display_name, favorite_team, username")
    .eq("id", userId)
    .maybeSingle();

  if (!full.error) {
    const row = (full.data as ProfileRowWithFavorite | null) ?? null;
    return {
      profile: {
        display_name: row?.display_name ?? null,
        favorite_team: row?.favorite_team ?? null,
        username: row?.username ?? null,
      },
      favoriteColumnAvailable: true,
      usernameColumnAvailable: true,
    };
  }

  const missingFavorite = isMissingColumnError(full.error.message, FAVORITE_TEAM_COLUMN);
  const missingUsername = isMissingColumnError(full.error.message, USERNAME_COLUMN);
  if (!missingFavorite && !missingUsername) {
    throw new Error(full.error.message);
  }

  if (missingFavorite && missingUsername) {
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
        username: null,
      },
      favoriteColumnAvailable: false,
      usernameColumnAvailable: false,
    };
  }

  const select = missingFavorite ? "id, display_name, username" : "id, display_name, favorite_team";
  const fallback = await service.from("profiles").select(select).eq("id", userId).maybeSingle();

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  const row = (fallback.data as any | null) ?? null;
  return {
    profile: {
      display_name: row?.display_name ?? null,
      favorite_team: missingFavorite ? null : row?.favorite_team ?? null,
      username: missingUsername ? null : row?.username ?? null,
    },
    favoriteColumnAvailable: !missingFavorite,
    usernameColumnAvailable: !missingUsername,
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
        username: profile.username,
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
      username?: string | null;
    };

    const hasDisplayName = typeof body?.display_name === "string";
    const hasFavoriteTeam = !!body && Object.prototype.hasOwnProperty.call(body, "favorite_team");
    const hasUsername = !!body && Object.prototype.hasOwnProperty.call(body, "username");

    if (!hasDisplayName && !hasFavoriteTeam && !hasUsername) {
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

    if (hasUsername) {
      const rawUsername = body?.username;
      if (rawUsername !== null && rawUsername !== undefined && typeof rawUsername !== "string") {
        return NextResponse.json({ error: "Invalid username" }, { status: 400 });
      }

      const usernameInput = typeof rawUsername === "string" ? rawUsername : "";
      const usernameTrimmed = usernameInput.trim();

      let nextUsername: string | null = null;
      if (usernameTrimmed.length > 0) {
        const validation = validateUsername(usernameTrimmed);
        if (!validation.ok) {
          return NextResponse.json({ error: validation.error }, { status: 400 });
        }
        nextUsername = validation.value;
      }

      const { error } = await service.from("profiles").upsert(
        {
          id: user.id,
          username: nextUsername,
        },
        { onConflict: "id" }
      );

      if (error) {
        if (isMissingColumnError(error.message, USERNAME_COLUMN)) {
          return NextResponse.json(
            {
              error: "Database is missing username column",
              details: "Run db/migrations/20260309_profiles_username.sql and redeploy.",
            },
            { status: 500 }
          );
        }
        if (isDuplicateUsernameError(error.message)) {
          return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
        }
        return NextResponse.json(
          { error: "Failed to save username", details: error.message },
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
        username: profile.username,
      },
    });
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update profile", details }, { status: 500 });
  }
}
