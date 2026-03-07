-- BL-004: self-service profile fields.
-- Adds optional favorite AFL team to user profiles.

alter table if exists public.profiles
  add column if not exists favorite_team text;
