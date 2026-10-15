create table if not exists public.workspace_snapshots (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.note_documents (
  owner_id uuid not null references auth.users (id) on delete cascade,
  note_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, note_id)
);

create table if not exists public.note_updates (
  id bigint generated always as identity primary key,
  owner_id uuid not null,
  note_id text not null,
  update_b64 text not null,
  created_at timestamptz not null default now(),
  foreign key (owner_id, note_id)
    references public.note_documents (owner_id, note_id)
    on delete cascade
);

create index if not exists note_updates_document_idx
  on public.note_updates (owner_id, note_id, id);

alter table public.workspace_snapshots enable row level security;
alter table public.note_documents enable row level security;
alter table public.note_updates enable row level security;

grant select, insert, update, delete on public.workspace_snapshots to authenticated;
grant select, insert, update, delete on public.note_documents to authenticated;
grant select, insert on public.note_updates to authenticated;
grant usage, select on sequence public.note_updates_id_seq to authenticated;

drop policy if exists "owners manage workspace snapshots" on public.workspace_snapshots;
create policy "owners manage workspace snapshots"
  on public.workspace_snapshots
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "owners manage note documents" on public.note_documents;
create policy "owners manage note documents"
  on public.note_documents
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "owners read note updates" on public.note_updates;
create policy "owners read note updates"
  on public.note_updates
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "owners append note updates" on public.note_updates;
create policy "owners append note updates"
  on public.note_updates
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "note owners receive private realtime" on realtime.messages;
create policy "note owners receive private realtime"
  on realtime.messages
  for select to authenticated
  using (
    extension in ('broadcast', 'presence')
    and (
      (select realtime.topic()) = 'workspace:' || (select auth.uid())::text
      or exists (
        select 1
        from public.note_documents as document
        where document.owner_id = (select auth.uid())
          and 'note:' || document.note_id = (select realtime.topic())
      )
    )
  );

drop policy if exists "note owners publish private realtime" on realtime.messages;
create policy "note owners publish private realtime"
  on realtime.messages
  for insert to authenticated
  with check (
    extension in ('broadcast', 'presence')
    and (
      (select realtime.topic()) = 'workspace:' || (select auth.uid())::text
      or exists (
        select 1
        from public.note_documents as document
        where document.owner_id = (select auth.uid())
          and 'note:' || document.note_id = (select realtime.topic())
      )
    )
  );

create or replace function public.broadcast_note_yjs_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('update_b64', new.update_b64),
    'yjs_update',
    'note:' || new.note_id,
    true
  );
  return new;
end;
$$;

drop trigger if exists note_yjs_update_broadcast on public.note_updates;
create trigger note_yjs_update_broadcast
  after insert on public.note_updates
  for each row execute function public.broadcast_note_yjs_update();
