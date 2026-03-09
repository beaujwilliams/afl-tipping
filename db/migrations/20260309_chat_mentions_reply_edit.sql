-- BL-023: chat ux upgrades.
-- Adds reply threading, edit marker support, and @mention notification rows.

alter table if exists public.chat_messages
  add column if not exists reply_to_message_id uuid;

alter table if exists public.chat_messages
  add column if not exists edited_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_reply_to_message_id_fkey'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_reply_to_message_id_fkey
      foreign key (reply_to_message_id)
      references public.chat_messages (id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_chat_messages_reply_to
  on public.chat_messages (reply_to_message_id);

create table if not exists public.chat_message_mentions (
  id bigserial primary key,
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  mentioned_username text not null,
  created_at timestamptz not null default now(),
  unique (message_id, mentioned_user_id)
);

create index if not exists idx_chat_message_mentions_target_created
  on public.chat_message_mentions (mentioned_user_id, created_at desc);

create index if not exists idx_chat_message_mentions_message
  on public.chat_message_mentions (message_id);

alter table if exists public.chat_message_mentions
  enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_message_mentions'
      and policyname = 'chat_message_mentions_select'
  ) then
    create policy chat_message_mentions_select
      on public.chat_message_mentions
      for select
      to authenticated
      using (
        mentioned_user_id = auth.uid()
        or exists (
          select 1
          from public.chat_messages m
          where m.id = message_id
            and m.user_id = auth.uid()
        )
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_message_mentions'
      and policyname = 'chat_message_mentions_insert'
  ) then
    create policy chat_message_mentions_insert
      on public.chat_message_mentions
      for insert
      to authenticated
      with check (
        exists (
          select 1
          from public.chat_messages m
          where m.id = message_id
            and m.user_id = auth.uid()
        )
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_message_mentions'
      and policyname = 'chat_message_mentions_delete'
  ) then
    create policy chat_message_mentions_delete
      on public.chat_message_mentions
      for delete
      to authenticated
      using (
        exists (
          select 1
          from public.chat_messages m
          where m.id = message_id
            and m.user_id = auth.uid()
        )
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_messages'
      and policyname = 'chat_messages_update_own'
  ) then
    create policy chat_messages_update_own
      on public.chat_messages
      for update
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end;
$$;
