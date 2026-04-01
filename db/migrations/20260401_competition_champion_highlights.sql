-- BL-0xx: support multiple gold-name champion highlights per competition.

alter table if exists public.competitions
  add column if not exists champion_highlight_user_ids uuid[];

alter table if exists public.competitions
  alter column champion_highlight_user_ids set default '{}'::uuid[];

update public.competitions
set champion_highlight_user_ids = '{}'::uuid[]
where champion_highlight_user_ids is null;

alter table if exists public.competitions
  alter column champion_highlight_user_ids set not null;
