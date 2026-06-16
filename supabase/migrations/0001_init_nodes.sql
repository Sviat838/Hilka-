-- Hilka schema — one table, the whole product (PLAN.md §4).
-- Applied to project htrvknxzunkqxcqsqxpm on 2026-06-12 via MCP.
-- Folds in the two hardening lessons from the first build:
--   no_self_parent CHECK, and parent-ownership enforced via a
--   SECURITY DEFINER probe (a policy may not query its own table).

create table public.nodes (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users(id),
  parent_id         uuid references public.nodes(id) on delete restrict,
  title             text not null,
  description       text not null default '',
  status            text not null default 'open'
                      check (status in ('open','accepted','declined','parked')),
  decline_reason    text,
  position          double precision not null default 1024,
  status_changed_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint decline_reason_required check (
    status <> 'declined'
    or (decline_reason is not null and btrim(decline_reason) <> '')
  ),
  constraint no_self_parent check (parent_id is null or parent_id <> id)
);

create index idx_nodes_user   on public.nodes (user_id);
create index idx_nodes_parent on public.nodes (parent_id);

alter table public.nodes enable row level security;

create or replace function public.parent_owned_by_caller(p_parent uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select p_parent is null
      or exists (
        select 1 from public.nodes
        where id = p_parent and user_id = auth.uid()
      );
$$;

revoke all on function public.parent_owned_by_caller(uuid) from public;
grant execute on function public.parent_owned_by_caller(uuid) to authenticated;

create policy owner_select on public.nodes
  for select using (user_id = (select auth.uid()));

create policy owner_insert on public.nodes
  for insert with check (
    user_id = (select auth.uid())
    and public.parent_owned_by_caller(parent_id)
  );

create policy owner_update on public.nodes
  for update using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.parent_owned_by_caller(parent_id)
  );

create policy owner_delete on public.nodes
  for delete using (user_id = (select auth.uid()));
