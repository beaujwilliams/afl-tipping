-- BL-019: username capture during sign-up with uniqueness and validation.

alter table if exists public.profiles
  add column if not exists username text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_username_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (
        username is null
        or (
          username = lower(username)
          and char_length(username) between 3 and 24
          and username ~ '^[a-z0-9_]+$'
        )
      );
  end if;
end;
$$;

create unique index if not exists ux_profiles_username_lower
  on public.profiles (lower(username))
  where username is not null;

